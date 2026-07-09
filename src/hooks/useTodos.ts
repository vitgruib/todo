import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Todo } from '../types';
import { clearReminderAlarm, scheduleReminderAlarm } from '../reminders';

const STORAGE_KEY = 'todo-ai-data-v2';
const ARCHIVE_KEY = 'todo-ai-archive-v1';

type LegacyTodo = Todo & { deadline?: string; addedToFocusAt?: number; bumpSentAt?: number };

const usingExtensionStorage = (): boolean =>
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

const safeParse = (raw: string | null): unknown => {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

// Migrate legacy shape: date-only `deadline` becomes an end-of-day `remindAt`; drop dead fields.
const migrate = (loaded: LegacyTodo[]): Todo[] =>
    loaded.map((raw) => {
        const { deadline, addedToFocusAt, bumpSentAt, ...rest } = raw;
        void addedToFocusAt;
        void bumpSentAt;
        const base = rest as Todo;
        if (base.remindAt == null && deadline) {
            const ms = new Date(`${deadline}T23:59:00`).getTime();
            if (!Number.isNaN(ms)) {
                return { ...base, remindAt: ms };
            }
        }
        return base;
    });

const toTodoList = (value: unknown): Todo[] =>
    Array.isArray(value) ? migrate(value as LegacyTodo[]) : [];

export const useTodos = () => {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [archivedTodos, setArchivedTodos] = useState<Todo[]>([]);

    // Guards the save effects: until the initial (possibly async) load has run,
    // the empty starting state must never be written back — otherwise a freshly
    // mounted window (e.g. the reminder popup) would clobber stored tasks.
    const hasLoadedRef = useRef(false);

    // Latest committed lists, so mutators can read current state without stale
    // closures and without nesting setState calls.
    const todosRef = useRef<Todo[]>(todos);
    const archiveRef = useRef<Todo[]>(archivedTodos);
    useEffect(() => {
        todosRef.current = todos;
    }, [todos]);
    useEffect(() => {
        archiveRef.current = archivedTodos;
    }, [archivedTodos]);

    // Serialized snapshots of what we last persisted or received from another
    // window. Used to skip redundant writes and to break cross-window echo loops.
    const lastTodosJsonRef = useRef<string | null>(null);
    const lastArchiveJsonRef = useRef<string | null>(null);

    // Initial load.
    useEffect(() => {
        const apply = (rawTodos: unknown, rawArchive: unknown) => {
            const loadedTodos = toTodoList(rawTodos);
            const loadedArchive = toTodoList(rawArchive);
            lastTodosJsonRef.current = JSON.stringify(loadedTodos);
            lastArchiveJsonRef.current = JSON.stringify(loadedArchive);
            setTodos(loadedTodos);
            setArchivedTodos(loadedArchive);
            hasLoadedRef.current = true;
        };

        if (usingExtensionStorage()) {
            chrome.storage.local.get([STORAGE_KEY, ARCHIVE_KEY], (result) => {
                apply(result[STORAGE_KEY], result[ARCHIVE_KEY]);
            });
        } else {
            apply(
                safeParse(localStorage.getItem(STORAGE_KEY)),
                safeParse(localStorage.getItem(ARCHIVE_KEY)),
            );
        }
    }, []);

    // Persist the active list (only after load, only when it actually changed).
    useEffect(() => {
        if (!hasLoadedRef.current) return;
        const json = JSON.stringify(todos);
        if (json === lastTodosJsonRef.current) return;
        lastTodosJsonRef.current = json;
        if (usingExtensionStorage()) {
            chrome.storage.local.set({ [STORAGE_KEY]: todos });
        } else {
            localStorage.setItem(STORAGE_KEY, json);
        }
    }, [todos]);

    // Persist the archive under the same rules.
    useEffect(() => {
        if (!hasLoadedRef.current) return;
        const json = JSON.stringify(archivedTodos);
        if (json === lastArchiveJsonRef.current) return;
        lastArchiveJsonRef.current = json;
        if (usingExtensionStorage()) {
            chrome.storage.local.set({ [ARCHIVE_KEY]: archivedTodos });
        } else {
            localStorage.setItem(ARCHIVE_KEY, json);
        }
    }, [archivedTodos]);

    // Keep every open window (main tab + reminder popup) in sync so one window
    // can't silently overwrite another's changes. Setting the *Json refs before
    // calling setState makes the following save effect a no-op, preventing an
    // endless write/notify echo between windows.
    useEffect(() => {
        if (usingExtensionStorage()) {
            const handler = (
                changes: { [key: string]: chrome.storage.StorageChange },
                areaName: string,
            ) => {
                if (areaName !== 'local') return;
                if (changes[STORAGE_KEY]) {
                    const next = toTodoList(changes[STORAGE_KEY].newValue);
                    const json = JSON.stringify(next);
                    if (json !== lastTodosJsonRef.current) {
                        lastTodosJsonRef.current = json;
                        setTodos(next);
                    }
                }
                if (changes[ARCHIVE_KEY]) {
                    const next = toTodoList(changes[ARCHIVE_KEY].newValue);
                    const json = JSON.stringify(next);
                    if (json !== lastArchiveJsonRef.current) {
                        lastArchiveJsonRef.current = json;
                        setArchivedTodos(next);
                    }
                }
            };
            chrome.storage.onChanged.addListener(handler);
            return () => chrome.storage.onChanged.removeListener(handler);
        }

        const handler = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY) {
                const next = toTodoList(safeParse(event.newValue));
                const json = JSON.stringify(next);
                if (json !== lastTodosJsonRef.current) {
                    lastTodosJsonRef.current = json;
                    setTodos(next);
                }
            } else if (event.key === ARCHIVE_KEY) {
                const next = toTodoList(safeParse(event.newValue));
                const json = JSON.stringify(next);
                if (json !== lastArchiveJsonRef.current) {
                    lastArchiveJsonRef.current = json;
                    setArchivedTodos(next);
                }
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    // `remindAt` undefined => long-term goal with no due date; otherwise a short-run task.
    const addTodo = (title: string, remindAt?: number) => {
        const newTodo: Todo = {
            id: uuidv4(),
            title,
            completed: false,
            steps: [],
            createdAt: Date.now(),
            remindAt,
        };
        if (remindAt != null) {
            scheduleReminderAlarm(newTodo.id, remindAt);
        }
        setTodos((prev) => [newTodo, ...prev]);
    };

    const deleteTodo = (id: string) => {
        clearReminderAlarm(id);
        setTodos((prev) => prev.filter((t) => t.id !== id));
    };

    // Completing a task never destroys it: it moves to the archive, stamped with
    // its completion time, and leaves the active list.
    const toggleTodo = (id: string) => {
        const target = todosRef.current.find((t) => t.id === id);
        if (!target) return;
        clearReminderAlarm(id);
        const entry: Todo = { ...target, completed: true, completedAt: Date.now() };
        setArchivedTodos((arch) => [entry, ...arch.filter((t) => t.id !== id)]);
        setTodos((prev) => prev.filter((t) => t.id !== id));
    };

    const updateTodo = (id: string, updates: Partial<Todo>) => {
        setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    };

    // Bring an archived task back to the active list as un-completed.
    const restoreTodo = (id: string) => {
        const target = archiveRef.current.find((t) => t.id === id);
        if (!target) return;
        const { completedAt, ...rest } = target;
        void completedAt;
        const restored: Todo = { ...rest, completed: false };
        if (restored.remindAt != null) {
            scheduleReminderAlarm(restored.id, restored.remindAt);
        }
        setArchivedTodos((arch) => arch.filter((t) => t.id !== id));
        setTodos((prev) => [restored, ...prev.filter((t) => t.id !== id)]);
    };

    const deleteArchived = (id: string) => {
        setArchivedTodos((arch) => arch.filter((t) => t.id !== id));
    };

    const clearArchive = () => {
        setArchivedTodos([]);
    };

    return {
        todos,
        archivedTodos,
        addTodo,
        deleteTodo,
        toggleTodo,
        updateTodo,
        restoreTodo,
        deleteArchived,
        clearArchive,
    };
};

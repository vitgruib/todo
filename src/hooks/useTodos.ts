import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Todo } from '../types';
import { clearReminderAlarm, scheduleReminderAlarm, DEFAULT_DUE_MS } from '../reminders';

const STORAGE_KEY = 'todo-ai-data-v2';

type LegacyTodo = Todo & { deadline?: string; addedToFocusAt?: number; bumpSentAt?: number };

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

export const useTodos = () => {
    const [todos, setTodos] = useState<Todo[]>([]);

    // Load from storage on mount
    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                if (result[STORAGE_KEY]) {
                    setTodos(migrate(result[STORAGE_KEY]));
                }
            });
        } else {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                setTodos(migrate(JSON.parse(saved)));
            }
        }
    }, []);

    // Save to storage whenever todos change
    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [STORAGE_KEY]: todos });
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
        }
    }, [todos]);

    // New tasks start as short-run with a due date.
    const addTodo = (title: string) => {
        const remindAt = Date.now() + DEFAULT_DUE_MS;
        const newTodo: Todo = {
            id: uuidv4(),
            title,
            completed: false,
            steps: [],
            createdAt: Date.now(),
            remindAt,
        };
        scheduleReminderAlarm(newTodo.id, remindAt);
        setTodos((prev) => [newTodo, ...prev]);
    };

    const deleteTodo = (id: string) => {
        clearReminderAlarm(id);
        setTodos((prev) => prev.filter((t) => t.id !== id));
    };

    const toggleTodo = (id: string, options?: { deleteIfCompleted?: boolean }) => {
        setTodos((prev) => {
            const next = prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
            const updated = next.find((t) => t.id === id);
            if (updated?.completed) {
                clearReminderAlarm(id);
                if (options?.deleteIfCompleted) {
                    return next.filter((t) => t.id !== id);
                }
            }
            return next;
        });
    };

    const updateTodo = (id: string, updates: Partial<Todo>) => {
        setTodos((prev) =>
            prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
        );
    };

    return {
        todos,
        addTodo,
        deleteTodo,
        toggleTodo,
        updateTodo,
    };
};

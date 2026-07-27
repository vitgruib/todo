import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Todo } from '../types';
import { clearReminderAlarm, scheduleReminderAlarm } from '../reminders';
import {
    getLocalAndSync,
    isSyncSnapshotChange,
    loadSyncPreference,
    replaceSyncedSnapshot,
    setLocalAndSync,
} from '../storage';
import { mergeTaskState, TaskState } from '../merge';
import {
    applyActiveTaskImport,
    findActiveTaskConflicts,
    parseTaskList,
    type DuplicateResolution,
} from '../backupImport';

const STORAGE_KEY = 'todo-ai-data-v2';
const ARCHIVE_KEY = 'todo-ai-archive-v1';
const TOMBSTONE_KEY = 'todo-ai-tombstones-v1';
export const SYNC_INITIALIZED_KEY = 'todo-ai-sync-initialized-v1';
export const SYNC_GENERATION_KEY = 'todo-ai-sync-generation-v1';

/** Every key holding task data — used when copying to/clearing from the sync store. */
export const TASK_KEYS = [STORAGE_KEY, ARCHIVE_KEY, TOMBSTONE_KEY];
export const SYNC_KEYS = [...TASK_KEYS, SYNC_INITIALIZED_KEY, SYNC_GENERATION_KEY];

export type BackupSnapshot = { tasks?: unknown; archive?: unknown; tombstones?: unknown };

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

// Defensive parsers: anything that isn't the expected shape (hostile/corrupt storage) becomes empty.
const toTodoList = (value: unknown): Todo[] => parseTaskList(value);

const toTombstones = (value: unknown): Record<string, number> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [id, ts] of Object.entries(value as Record<string, unknown>)) {
        if (id && typeof ts === 'number' && Number.isFinite(ts)) out[id] = ts;
    }
    return out;
};

const parseState = (obj: { [key: string]: unknown }): TaskState => ({
    active: toTodoList(obj[STORAGE_KEY]),
    archived: toTodoList(obj[ARCHIVE_KEY]),
    tombstones: toTombstones(obj[TOMBSTONE_KEY]),
});

const readGeneration = (obj: { [key: string]: unknown }): string | null =>
    typeof obj[SYNC_GENERATION_KEY] === 'string' ? obj[SYNC_GENERATION_KEY] : null;

const taskStoragePayload = (state: TaskState) => ({
    [STORAGE_KEY]: state.active,
    [ARCHIVE_KEY]: state.archived,
    [TOMBSTONE_KEY]: state.tombstones,
});

const parseLocalStorageState = (): TaskState => ({
    active: toTodoList(safeParse(localStorage.getItem(STORAGE_KEY))),
    archived: toTodoList(safeParse(localStorage.getItem(ARCHIVE_KEY))),
    tombstones: toTombstones(safeParse(localStorage.getItem(TOMBSTONE_KEY))),
});

// Deterministic order (newest first, id as tiebreak) so every device serializes identically —
// which lets the canonical string below reliably detect "nothing changed" and break echo loops.
const cmpTask = (a: Todo, b: Todo): number =>
    b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const sortState = (s: TaskState): TaskState => ({
    active: [...s.active].sort(cmpTask),
    archived: [...s.archived].sort(cmpTask),
    tombstones: s.tombstones,
});

const canonical = (s: TaskState): string => {
    const tombs = Object.keys(s.tombstones)
        .sort()
        .reduce<Record<string, number>>((acc, k) => {
            acc[k] = s.tombstones[k];
            return acc;
        }, {});
    return JSON.stringify({ active: s.active, archived: s.archived, tombstones: tombs });
};

// Persist to local (durable, per-device) plus sync (shared, best-effort). Module-level: it touches
// no component state, only refs' *values* are passed in — so it's stable and safe in hook deps.
const writeStorage = (s: TaskState, callback?: () => void) => {
    if (usingExtensionStorage()) {
        setLocalAndSync({
            ...taskStoragePayload(s),
        }, callback);
    } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s.active));
        localStorage.setItem(ARCHIVE_KEY, JSON.stringify(s.archived));
        localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(s.tombstones));
        callback?.();
    }
};

export const useTodos = () => {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [archivedTodos, setArchivedTodos] = useState<Todo[]>([]);

    // Until the initial (async) load runs, an empty state must never be persisted or merged.
    const hasLoadedRef = useRef(false);
    // Current committed state, updated synchronously in commit() so back-to-back mutations compose.
    const todosRef = useRef<Todo[]>([]);
    const archiveRef = useRef<Todo[]>([]);
    const tombstonesRef = useRef<Record<string, number>>({});
    const syncGenerationRef = useRef<string | null>(null);
    const isAuthoritativeSyncWriteRef = useRef(false);
    // Canonical serialization of what we last committed — skips redundant work and breaks the
    // write → onChanged → write echo between windows/devices.
    const lastCanonicalRef = useRef<string | null>(null);

    // The single funnel for every state change: normalize, no-op if unchanged (breaks echo loops),
    // update refs + React state synchronously, then persist to local (durable) + sync (shared).
    // Stable (only touches refs + stable setters), so it's safe as an effect dependency.
    const commit = useCallback((next: TaskState, forcePersist = false, callback?: () => void) => {
        const sorted = sortState(next);
        const canon = canonical(sorted);
        if (canon === lastCanonicalRef.current && !forcePersist) return;
        lastCanonicalRef.current = canon;
        todosRef.current = sorted.active;
        archiveRef.current = sorted.archived;
        tombstonesRef.current = sorted.tombstones;
        setTodos(sorted.active);
        setArchivedTodos(sorted.archived);
        writeStorage(sorted, callback);
    }, []);

    const adoptExactSyncState = useCallback((next: TaskState, generation: string | null) => {
        const sorted = sortState(next);
        syncGenerationRef.current = generation;
        lastCanonicalRef.current = canonical(sorted);
        todosRef.current = sorted.active;
        archiveRef.current = sorted.archived;
        tombstonesRef.current = sorted.tombstones;
        setTodos(sorted.active);
        setArchivedTodos(sorted.archived);
        if (usingExtensionStorage()) {
            chrome.storage.local.set(
                {
                    ...taskStoragePayload(sorted),
                    ...(generation ? { [SYNC_GENERATION_KEY]: generation } : {}),
                },
                () => void chrome.runtime.lastError,
            );
        }
    }, []);

    // Initial load: merge whatever's in local (this device's durable copy) with whatever's in sync
    // (the shared, possibly-newer copy), and only write back if that reconciliation changed anything.
    useEffect(() => {
        const adopt = (merged: TaskState, needsWrite: boolean) => {
            const sorted = sortState(merged);
            hasLoadedRef.current = true;
            lastCanonicalRef.current = canonical(sorted);
            todosRef.current = sorted.active;
            archiveRef.current = sorted.archived;
            tombstonesRef.current = sorted.tombstones;
            setTodos(sorted.active);
            setArchivedTodos(sorted.archived);
            if (needsWrite) writeStorage(sorted);
        };

        if (usingExtensionStorage()) {
            // Read this device's sync preference first — it decides whether the sync store is
            // consulted at all, so it must be known before any task data is read or written.
            loadSyncPreference(() => {
                getLocalAndSync([...TASK_KEYS, SYNC_GENERATION_KEY], (local, synced) => {
                    const localState = parseState(local);
                    const syncState = parseState(synced);
                    const localGeneration = readGeneration(local);
                    const syncedGeneration = readGeneration(synced);
                    if (syncedGeneration && syncedGeneration !== localGeneration) {
                        hasLoadedRef.current = true;
                        adoptExactSyncState(syncState, syncedGeneration);
                        return;
                    }
                    const merged = mergeTaskState(localState, syncState);
                    const canon = canonical(sortState(merged));
                    const needsWrite =
                        canon !== canonical(sortState(localState)) ||
                        canon !== canonical(sortState(syncState));
                    adopt(merged, needsWrite);
                });
            });
        } else {
            // Even single-store, run the merge so any internal contradiction (e.g. a task present
            // and tombstoned at once, from tampering) self-resolves; write back only if it changed.
            const raw = parseLocalStorageState();
            const merged = mergeTaskState(raw);
            const needsWrite = canonical(sortState(merged)) !== canonical(sortState(raw));
            adopt(merged, needsWrite);
        }
    }, [adoptExactSyncState]);

    // Live updates from another window (same device) or another computer (via sync): re-read both
    // stores, merge with our current state, and commit. commit()'s guard makes our own writes no-ops.
    useEffect(() => {
        if (usingExtensionStorage()) {
            const handler = (
                changes: { [key: string]: chrome.storage.StorageChange },
                areaName: string,
            ) => {
                if (areaName !== 'local' && areaName !== 'sync') return;
                const hasTaskChange =
                    STORAGE_KEY in changes ||
                    ARCHIVE_KEY in changes ||
                    TOMBSTONE_KEY in changes ||
                    SYNC_GENERATION_KEY in changes ||
                    (areaName === 'sync' && isSyncSnapshotChange(changes));
                if (!hasTaskChange)
                    return;
                if (!hasLoadedRef.current) return;
                if (isAuthoritativeSyncWriteRef.current) return;
                getLocalAndSync([...TASK_KEYS, SYNC_GENERATION_KEY], (local, synced) => {
                    const syncedGeneration = readGeneration(synced);
                    if (
                        areaName === 'sync' &&
                        syncedGeneration &&
                        syncedGeneration !== syncGenerationRef.current
                    ) {
                        adoptExactSyncState(parseState(synced), syncedGeneration);
                        return;
                    }
                    const incoming = mergeTaskState(parseState(local), parseState(synced));
                    const mine: TaskState = {
                        active: todosRef.current,
                        archived: archiveRef.current,
                        tombstones: tombstonesRef.current,
                    };
                    commit(mergeTaskState(incoming, mine));
                });
            };
            chrome.storage.onChanged.addListener(handler);
            return () => chrome.storage.onChanged.removeListener(handler);
        }

        const handler = (event: StorageEvent) => {
            if (
                event.key !== STORAGE_KEY &&
                event.key !== ARCHIVE_KEY &&
                event.key !== TOMBSTONE_KEY
            ) {
                return;
            }
            if (!hasLoadedRef.current) return;
            const mine: TaskState = {
                active: todosRef.current,
                archived: archiveRef.current,
                tombstones: tombstonesRef.current,
            };
            commit(mergeTaskState(parseLocalStorageState(), mine));
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, [adoptExactSyncState, commit]);

    // `remindAt` undefined => long-term goal with no due date; otherwise a short-run task.
    const addTodo = (title: string, remindAt?: number, urgent = false) => {
        const now = Date.now();
        const newTodo: Todo = {
            id: uuidv4(),
            title,
            completed: false,
            steps: [],
            createdAt: now,
            remindAt,
            urgent,
            updatedAt: now,
        };
        if (remindAt != null) {
            scheduleReminderAlarm(newTodo.id, remindAt);
        }
        commit({
            active: [newTodo, ...todosRef.current],
            archived: archiveRef.current,
            tombstones: tombstonesRef.current,
        });
    };

    // Deleting records a tombstone (with a timestamp) so the task can't be resurrected by a device
    // that still has an older copy — the delete wins unless a later edit/undo overrides it.
    const deleteTodo = (id: string) => {
        clearReminderAlarm(id);
        commit({
            active: todosRef.current.filter((t) => t.id !== id),
            archived: archiveRef.current,
            tombstones: { ...tombstonesRef.current, [id]: Date.now() },
        });
    };

    // Completing a task never destroys it: it moves to the archive, stamped with its completion time.
    const toggleTodo = (id: string) => {
        const target = todosRef.current.find((t) => t.id === id);
        if (!target) return;
        clearReminderAlarm(id);
        const now = Date.now();
        const entry: Todo = { ...target, completed: true, completedAt: now, updatedAt: now };
        commit({
            active: todosRef.current.filter((t) => t.id !== id),
            archived: [entry, ...archiveRef.current.filter((t) => t.id !== id)],
            tombstones: tombstonesRef.current,
        });
    };

    const updateTodo = (id: string, updates: Partial<Todo>) => {
        const now = Date.now();
        commit({
            active: todosRef.current.map((t) =>
                t.id === id ? { ...t, ...updates, updatedAt: now } : t,
            ),
            archived: archiveRef.current,
            tombstones: tombstonesRef.current,
        });
    };

    // Bring an archived task back to the active list as un-completed.
    const restoreTodo = (id: string) => {
        const target = archiveRef.current.find((t) => t.id === id);
        if (!target) return;
        const { completedAt, ...rest } = target;
        void completedAt;
        const restored: Todo = { ...rest, completed: false, updatedAt: Date.now() };
        if (restored.remindAt != null) {
            scheduleReminderAlarm(restored.id, restored.remindAt);
        }
        commit({
            active: [restored, ...todosRef.current.filter((t) => t.id !== id)],
            archived: archiveRef.current.filter((t) => t.id !== id),
            tombstones: tombstonesRef.current,
        });
    };

    const deleteArchived = (id: string) => {
        commit({
            active: todosRef.current,
            archived: archiveRef.current.filter((t) => t.id !== id),
            tombstones: { ...tombstonesRef.current, [id]: Date.now() },
        });
    };

    const clearArchive = () => {
        const now = Date.now();
        const tombstones = { ...tombstonesRef.current };
        for (const t of archiveRef.current) tombstones[t.id] = now;
        commit({ active: todosRef.current, archived: [], tombstones });
    };

    // Re-insert a previously-deleted task (undo a delete). A fresh updatedAt beats its tombstone,
    // and we drop the local tombstone so it can't shadow the revived task.
    const reinsertTodo = (todo: Todo) => {
        const revived: Todo = { ...todo, updatedAt: Date.now() };
        if (revived.remindAt != null && !revived.completed) {
            scheduleReminderAlarm(revived.id, revived.remindAt);
        }
        const tombstones = { ...tombstonesRef.current };
        delete tombstones[revived.id];
        commit({
            active: [revived, ...todosRef.current.filter((t) => t.id !== revived.id)],
            archived: archiveRef.current,
            tombstones,
        });
    };

    /** Raw task data for a backup file. Task objects keep all their fields as-is, so every date
     *  (createdAt / remindAt / completedAt / updatedAt — all epoch ms) round-trips exactly. */
    const exportSnapshot = (): {
        tasks: Todo[];
        archive: Todo[];
        tombstones: Record<string, number>;
    } => ({
        tasks: todosRef.current,
        archive: archiveRef.current,
        // Carried along so re-importing an old file can't resurrect things you deleted since.
        tombstones: tombstonesRef.current,
    });

    /**
     * Import a parsed backup using an explicit conflict policy. Inputs are parsed defensively, so
     * malformed task data is ignored rather than crashing. Returns how many task records were
     * added to the active list and archive.
     */
    const previewImportSnapshot = (data: BackupSnapshot) => {
        const incoming = toTodoList(data.tasks);
        return {
            activeDuplicates: findActiveTaskConflicts(
                {
                    active: todosRef.current,
                    archived: archiveRef.current,
                    tombstones: tombstonesRef.current,
                },
                incoming,
            ).length,
        };
    };

    const importSnapshot = (
        data: BackupSnapshot,
        resolution: DuplicateResolution = 'keep-existing',
    ): number => {
        const incoming = toTodoList(data.tasks);
        const before = todosRef.current.length;
        commit(
            applyActiveTaskImport(
                {
                    active: todosRef.current,
                    archived: archiveRef.current,
                    tombstones: tombstonesRef.current,
                },
                incoming,
                resolution,
                Date.now(),
            ),
        );
        // commit updates the refs synchronously, so this reflects the merged result.
        const after = todosRef.current.length;
        return Math.max(0, after - before);
    };

    /** Make this device the account-wide sync source, including tombstones for displaced tasks. */
    const replaceSyncedTasks = () => {
        if (!usingExtensionStorage()) return;
        getLocalAndSync(TASK_KEYS, (_local, synced) => {
            const existing = parseState(synced);
            const now = Date.now();
            const active = todosRef.current.map((task) => ({ ...task, updatedAt: now }));
            const archived = archiveRef.current.map((task) => ({ ...task, updatedAt: now }));
            const currentIds = new Set([
                ...active.map((task) => task.id),
                ...archived.map((task) => task.id),
            ]);
            const tombstones = { ...tombstonesRef.current };
            for (const task of [...existing.active, ...existing.archived]) {
                if (!currentIds.has(task.id)) tombstones[task.id] = now;
            }
            const baseState = {
                active,
                archived,
                tombstones,
            };
            isAuthoritativeSyncWriteRef.current = true;
            replaceSyncedSnapshot(taskStoragePayload(baseState), (generation) => {
                isAuthoritativeSyncWriteRef.current = false;
                if (generation) adoptExactSyncState(baseState, generation);
            });
        });
    };

    /** Discard this device's task state in favor of the current account-wide synced task state. */
    const replaceWithSyncedTasks = () => {
        if (!usingExtensionStorage()) return;
        getLocalAndSync([...TASK_KEYS, SYNC_GENERATION_KEY], (_local, synced) => {
            adoptExactSyncState(parseState(synced), readGeneration(synced));
        });
    };

    // Restore a whole archive list that was just cleared (undo "Clear archive").
    const restoreArchive = (entries: Todo[]) => {
        const now = Date.now();
        const existing = new Set(archiveRef.current.map((t) => t.id));
        const revived = entries
            .filter((t) => !existing.has(t.id))
            .map((t) => ({ ...t, updatedAt: now }));
        const tombstones = { ...tombstonesRef.current };
        for (const t of revived) delete tombstones[t.id];
        commit({
            active: todosRef.current,
            archived: [...archiveRef.current, ...revived],
            tombstones,
        });
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
        reinsertTodo,
        restoreArchive,
        exportSnapshot,
        previewImportSnapshot,
        importSnapshot,
        replaceSyncedTasks,
        replaceWithSyncedTasks,
    };
};

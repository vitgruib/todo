import type { TaskState } from './merge';
import type { Step, Todo } from './types';
import { v4 as uuidv4 } from 'uuid';

export type DuplicateResolution = 'keep-existing' | 'keep-imported' | 'keep-both';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const isStep = (value: unknown): value is Step =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.completed === 'boolean';

const normalizeTask = (value: unknown): Todo | null => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;
    if (typeof value.title !== 'string' || !value.title.trim()) return null;
    if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null;

    const steps = Array.isArray(value.steps)
        ? value.steps
              .filter(isStep)
              .map((step) => ({ id: step.id, title: step.title, completed: step.completed }))
        : [];
    const task: Todo = {
        id: value.id,
        title: value.title.trim(),
        completed: value.completed === true,
        steps,
        createdAt: value.createdAt,
    };
    if (typeof value.remindAt === 'number' && Number.isFinite(value.remindAt)) {
        task.remindAt = value.remindAt;
    } else if (typeof value.deadline === 'string') {
        const legacyReminder = new Date(`${value.deadline}T23:59:00`).getTime();
        if (!Number.isNaN(legacyReminder)) task.remindAt = legacyReminder;
    }
    if (typeof value.delayCount === 'number' && Number.isFinite(value.delayCount)) {
        task.delayCount = Math.max(0, Math.floor(value.delayCount));
    }
    if (value.urgent === true) task.urgent = true;
    if (typeof value.completedAt === 'number' && Number.isFinite(value.completedAt)) {
        task.completedAt = value.completedAt;
    }
    if (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)) {
        task.updatedAt = value.updatedAt;
    }
    if (typeof value.lastDelayedAt === 'number' && Number.isFinite(value.lastDelayedAt)) {
        task.lastDelayedAt = value.lastDelayedAt;
    }
    return task;
};

/** Parse only complete, display-safe task records from a backup or stored list. */
export const parseTaskList = (value: unknown): Todo[] =>
    Array.isArray(value)
        ? value.flatMap((entry) => {
              const task = normalizeTask(entry);
              return task ? [task] : [];
          })
        : [];

const activeTask = (task: Todo, now: number): Todo => {
    const { completedAt, ...rest } = task;
    void completedAt;
    return {
        ...rest,
        completed: false,
        updatedAt: now,
    };
};

const normalizedTitle = (task: Todo): string => task.title.trim().toLowerCase();

const matchesActiveTask = (local: Todo, imported: Todo): boolean =>
    local.id === imported.id ||
    (normalizedTitle(local).length > 0 && normalizedTitle(local) === normalizedTitle(imported));

/** IDs shared by an imported active task and a local active task. */
export const findActiveTaskConflicts = (current: TaskState, imported: Todo[]): string[] => {
    return [
        ...new Set(
            imported
                .filter((importedTask) =>
                    current.active.some((localTask) => matchesActiveTask(localTask, importedTask)),
                )
                .map((task) => task.id),
        ),
    ];
};

/** Import active backup tasks only. Archives in the backup are deliberately ignored. */
export const applyActiveTaskImport = (
    current: TaskState,
    imported: Todo[],
    resolution: DuplicateResolution,
    now: number,
): TaskState => {
    const isConflict = (task: Todo) =>
        current.active.some((localTask) => matchesActiveTask(localTask, task));
    const archivedIds = new Set(current.archived.map((task) => task.id));
    const activeIds = new Set(current.active.map((task) => task.id));
    const usedIds = new Set([...archivedIds, ...(resolution === 'keep-both' ? activeIds : [])]);
    const incoming = imported.map((task) => {
        const id = usedIds.has(task.id) ? uuidv4() : task.id;
        usedIds.add(id);
        return { source: task, task: activeTask({ ...task, id }, now) };
    });
    const sourceIds = new Set(imported.map((task) => task.id));

    if (resolution === 'keep-existing') {
        return {
            active: [
                ...current.active,
                ...incoming.filter(({ source }) => !isConflict(source)).map(({ task }) => task),
            ],
            archived: current.archived,
            tombstones: Object.fromEntries(
                Object.entries(current.tombstones).filter(([id]) => !sourceIds.has(id)),
            ),
        };
    }

    if (resolution === 'keep-both') {
        return {
            active: [...current.active, ...incoming.map(({ task }) => task)],
            archived: current.archived,
            tombstones: Object.fromEntries(
                Object.entries(current.tombstones).filter(([id]) => !sourceIds.has(id)),
            ),
        };
    }

    return {
        active: [
            ...current.active.filter(
                (localTask) =>
                    !imported.some((importedTask) => matchesActiveTask(localTask, importedTask)),
            ),
            ...incoming.map(({ task }) => task),
        ],
        archived: current.archived,
        tombstones: Object.fromEntries(
            Object.entries(current.tombstones).filter(([id]) => !sourceIds.has(id)),
        ),
    };
};

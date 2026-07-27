import type { Todo } from './types';

/** A device's full task state: the two visible lists plus tombstones (id → deletion time). */
export interface TaskState {
    active: Todo[];
    archived: Todo[];
    tombstones: Record<string, number>;
}

/**
 * Deletions are remembered this long so a device that was offline can't resurrect a task deleted
 * elsewhere; past this window they're pruned so tombstones can't grow without bound.
 */
export const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/** When a task record was last touched — the basis for "newest write wins". Robust to bad data. */
const timeOf = (t: Todo): number => {
    if (typeof t.updatedAt === 'number' && Number.isFinite(t.updatedAt)) return t.updatedAt;
    if (typeof t.completedAt === 'number' && Number.isFinite(t.completedAt)) return t.completedAt;
    if (typeof t.createdAt === 'number' && Number.isFinite(t.createdAt)) return t.createdAt;
    return 0;
};

type Kind = 'active' | 'archived' | 'dead';
// Tie-breaker when two records share a timestamp, so every device makes the same choice.
const RANK: Record<Kind, number> = { dead: 3, archived: 2, active: 1 };

const emptyState = (): TaskState => ({ active: [], archived: [], tombstones: {} });

/**
 * Merge two task states into one, resolving every per-id contradiction identically on every device:
 * the record with the newest timestamp wins. A deletion is a timestamped record too, so a delete
 * newer than an edit removes the task, and an edit (or undo) newer than a delete revives it. Equal
 * timestamps break by kind (deleted > archived > active) so all devices converge to the same state.
 *
 * Pure, commutative, idempotent, and defensive against malformed/hostile input (missing ids, wrong
 * types, non-arrays) — safe to run in any order, any number of times, on anything.
 */
export const mergeTaskState = (
    a: TaskState = emptyState(),
    b: TaskState = emptyState(),
    now: number = Date.now(),
): TaskState => {
    const best = new Map<string, { kind: Kind; time: number; task?: Todo }>();

    const offer = (id: string, kind: Kind, time: number, task?: Todo) => {
        const cur = best.get(id);
        if (!cur || time > cur.time || (time === cur.time && RANK[kind] > RANK[cur.kind])) {
            best.set(id, { kind, time, task });
        }
    };

    const offerList = (list: Todo[] | undefined, kind: 'active' | 'archived') => {
        if (!Array.isArray(list)) return;
        for (const t of list) {
            if (t && typeof t.id === 'string' && t.id) offer(t.id, kind, timeOf(t), t);
        }
    };

    const offerTombs = (tombs: Record<string, number> | undefined) => {
        if (!tombs || typeof tombs !== 'object') return;
        for (const [id, time] of Object.entries(tombs)) {
            if (id && typeof time === 'number' && Number.isFinite(time)) offer(id, 'dead', time);
        }
    };

    offerList(a.active, 'active');
    offerList(b.active, 'active');
    offerList(a.archived, 'archived');
    offerList(b.archived, 'archived');
    offerTombs(a.tombstones);
    offerTombs(b.tombstones);

    const result = emptyState();
    for (const [id, rec] of best) {
        if (rec.kind === 'active' && rec.task) {
            result.active.push(rec.task);
        } else if (rec.kind === 'archived' && rec.task) {
            result.archived.push(rec.task);
        } else if (rec.kind === 'dead' && now - rec.time < TOMBSTONE_TTL_MS) {
            result.tombstones[id] = rec.time;
        }
        // A tombstone older than the TTL is dropped entirely (garbage-collected).
    }
    return result;
};

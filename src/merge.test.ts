import { describe, expect, it } from 'vitest';
import { mergeTaskState, TaskState, TOMBSTONE_TTL_MS } from './merge';
import type { Todo } from './types';

const NOW = 1_000_000_000_000;

const task = (id: string, o: Partial<Todo> = {}): Todo => ({
    id,
    title: id,
    completed: false,
    steps: [],
    createdAt: NOW - 1000,
    ...o,
});

const state = (o: Partial<TaskState> = {}): TaskState => ({
    active: [],
    archived: [],
    tombstones: {},
    ...o,
});

// Compare two states ignoring array order (merge output order isn't meaningful).
const normalize = (s: TaskState) => ({
    active: [...s.active].map((t) => t.id).sort(),
    archived: [...s.archived].map((t) => t.id).sort(),
    tombstones: s.tombstones,
    byId: Object.fromEntries([...s.active, ...s.archived].map((t) => [t.id, t])),
});

describe('mergeTaskState — no data loss', () => {
    it('keeps both tasks when each device added a different one', () => {
        const a = state({ active: [task('x', { updatedAt: NOW })] });
        const b = state({ active: [task('y', { updatedAt: NOW })] });
        const m = normalize(mergeTaskState(a, b, NOW));
        expect(m.active).toEqual(['x', 'y']);
    });

    it('newer edit of the same task wins', () => {
        const a = state({ active: [task('x', { title: 'old', updatedAt: NOW - 100 })] });
        const b = state({ active: [task('x', { title: 'new', updatedAt: NOW })] });
        expect(normalize(mergeTaskState(a, b, NOW)).byId.x.title).toBe('new');
        // ...regardless of argument order
        expect(normalize(mergeTaskState(b, a, NOW)).byId.x.title).toBe('new');
    });
});

describe('mergeTaskState — deletes and revivals', () => {
    it('a delete newer than an edit removes the task', () => {
        const edited = state({ active: [task('x', { updatedAt: NOW - 100 })] });
        const deleted = state({ tombstones: { x: NOW } });
        const m = normalize(mergeTaskState(edited, deleted, NOW));
        expect(m.active).toEqual([]);
        expect(m.tombstones).toEqual({ x: NOW });
    });

    it('an edit/undo newer than a delete revives the task', () => {
        const deleted = state({ tombstones: { x: NOW - 100 } });
        const revived = state({ active: [task('x', { updatedAt: NOW })] });
        const m = normalize(mergeTaskState(deleted, revived, NOW));
        expect(m.active).toEqual(['x']);
        expect(m.tombstones).toEqual({});
    });

    it('does NOT resurrect a task a stale device still holds but was deleted elsewhere', () => {
        const stale = state({ active: [task('x', { updatedAt: NOW - 5000 })] });
        const deletedLater = state({ tombstones: { x: NOW - 100 } });
        const m = normalize(mergeTaskState(stale, deletedLater, NOW));
        expect(m.active).toEqual([]);
        expect(m.tombstones.x).toBe(NOW - 100);
    });
});

describe('mergeTaskState — complete vs. reschedule across lists', () => {
    it('newer complete beats older snooze (task ends archived, not active)', () => {
        const snoozed = state({
            active: [task('x', { remindAt: NOW + 999, updatedAt: NOW - 50 })],
        });
        const done = state({
            archived: [task('x', { completed: true, completedAt: NOW, updatedAt: NOW })],
        });
        const m = normalize(mergeTaskState(snoozed, done, NOW));
        expect(m.active).toEqual([]);
        expect(m.archived).toEqual(['x']);
    });

    it('newer snooze beats older complete (task stays active)', () => {
        const done = state({
            archived: [task('x', { completed: true, completedAt: NOW - 50, updatedAt: NOW - 50 })],
        });
        const snoozed = state({ active: [task('x', { remindAt: NOW + 999, updatedAt: NOW })] });
        const m = normalize(mergeTaskState(done, snoozed, NOW));
        expect(m.active).toEqual(['x']);
        expect(m.archived).toEqual([]);
    });
});

describe('mergeTaskState — algebraic properties (convergence)', () => {
    const a = state({
        active: [task('x', { updatedAt: NOW }), task('y', { updatedAt: NOW - 10 })],
        archived: [task('z', { completed: true, updatedAt: NOW - 20 })],
        tombstones: { d: NOW - 5 },
    });
    const b = state({
        active: [task('y', { title: 'y2', updatedAt: NOW })],
        tombstones: { x: NOW - 1 },
    });

    it('is idempotent: merge(a, a) === a', () => {
        expect(normalize(mergeTaskState(a, a, NOW))).toEqual(normalize(a));
    });

    it('is commutative: merge(a, b) === merge(b, a)', () => {
        expect(normalize(mergeTaskState(a, b, NOW))).toEqual(normalize(mergeTaskState(b, a, NOW)));
    });

    it('is associative-ish: re-merging a prior result changes nothing', () => {
        const once = mergeTaskState(a, b, NOW);
        const twice = mergeTaskState(once, b, NOW);
        expect(normalize(twice)).toEqual(normalize(once));
    });
});

describe('mergeTaskState — tombstone GC', () => {
    it('drops tombstones older than the TTL but keeps recent ones', () => {
        const s = state({
            tombstones: { old: NOW - TOMBSTONE_TTL_MS - 1, recent: NOW - 1000 },
        });
        const m = mergeTaskState(s, state(), NOW);
        expect(m.tombstones).toEqual({ recent: NOW - 1000 });
    });
});

describe('mergeTaskState — hostile / malformed input never crashes', () => {
    it('ignores non-arrays, missing ids, and wrong-typed tombstones', () => {
        const junk = {
            active: [null, {}, { id: '' }, 42, task('good', { updatedAt: NOW })],
            archived: 'not an array',
            tombstones: { valid: NOW - 10, bad: 'nope', empty: NaN },
        } as unknown as TaskState;
        const m = normalize(mergeTaskState(junk, state(), NOW));
        expect(m.active).toEqual(['good']);
        expect(m.archived).toEqual([]);
        expect(m.tombstones).toEqual({ valid: NOW - 10 });
    });

    it('tolerates undefined inputs entirely', () => {
        expect(() => mergeTaskState(undefined, undefined, NOW)).not.toThrow();
        const m = mergeTaskState(undefined, undefined, NOW);
        expect(m).toEqual({ active: [], archived: [], tombstones: {} });
    });
});

describe('mergeTaskState — legacy tasks without updatedAt', () => {
    it('falls back to createdAt, and a timestamped edit still wins over a legacy copy', () => {
        const legacy = state({ active: [task('x', { title: 'legacy', createdAt: NOW - 1000 })] });
        const edited = state({ active: [task('x', { title: 'edited', updatedAt: NOW })] });
        expect(normalize(mergeTaskState(legacy, edited, NOW)).byId.x.title).toBe('edited');
    });
});

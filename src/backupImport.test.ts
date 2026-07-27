import { describe, expect, it } from 'vitest';
import { applyActiveTaskImport, findActiveTaskConflicts, parseTaskList } from './backupImport';
import type { TaskState } from './merge';
import type { Todo } from './types';

const NOW = 1_000_000_000_000;

const todo = (id: string, updates: Partial<Todo> = {}): Todo => ({
    id,
    title: id,
    completed: false,
    steps: [],
    createdAt: NOW - 1_000,
    updatedAt: NOW - 1_000,
    ...updates,
});

const state = (updates: Partial<TaskState> = {}): TaskState => ({
    active: [],
    archived: [],
    tombstones: {},
    ...updates,
});

describe('parseTaskList', () => {
    it('accepts complete task data and discards unknown fields', () => {
        const [task] = parseTaskList([
            {
                ...todo('valid'),
                unexpected: 'discard me',
                steps: [{ id: 'step', title: 'Step', completed: false, extra: true }],
            },
        ]);

        expect(task).toEqual({
            ...todo('valid'),
            steps: [{ id: 'step', title: 'Step', completed: false }],
        });
    });

    it('rejects malformed records instead of passing broken tasks to the UI', () => {
        const tasks = parseTaskList([
            null,
            'not a task',
            { id: 'missing-title', createdAt: NOW },
            { id: 'missing-date', title: 'Task' },
            { id: '', title: 'Task', createdAt: NOW },
            { id: 'valid', title: 'Task', createdAt: NOW, steps: 'not an array' },
        ]);

        expect(tasks).toEqual([expect.objectContaining({ id: 'valid', title: 'Task', steps: [] })]);
    });

    it('migrates a legacy date-only deadline', () => {
        const [task] = parseTaskList([
            { id: 'legacy', title: 'Legacy', createdAt: NOW, deadline: '2026-07-27' },
        ]);

        expect(task.remindAt).toBe(new Date('2026-07-27T23:59:00').getTime());
    });
});

describe('active backup imports', () => {
    it('detects imported active tasks that match an active task by ID or title', () => {
        const conflicts = findActiveTaskConflicts(
            state({
                active: [todo('same-id'), todo('different-id', { title: 'Same title' })],
                archived: [todo('archived')],
            }),
            [
                todo('same-id'),
                todo('new-id', { title: ' same TITLE ' }),
                todo('archived'),
                todo('new'),
            ],
        );

        expect(conflicts).toEqual(['same-id', 'new-id']);
    });

    it('imports new active tasks without touching the archive', () => {
        const result = applyActiveTaskImport(
            state({ archived: [todo('done', { completed: true, completedAt: NOW - 50 })] }),
            [todo('new')],
            'keep-existing',
            NOW,
        );

        expect(result.active).toEqual([expect.objectContaining({ id: 'new', updatedAt: NOW })]);
        expect(result.archived.map((entry) => entry.id)).toEqual(['done']);
    });

    it('imports an active task without prompting when only an archived task shares its ID', () => {
        const result = applyActiveTaskImport(
            state({ archived: [todo('same', { completed: true, completedAt: NOW - 50 })] }),
            [todo('same')],
            'keep-existing',
            NOW,
        );

        expect(result.active).toEqual([expect.objectContaining({ completed: false })]);
        expect(result.active[0].id).not.toBe('same');
        expect(result.archived.map((entry) => entry.id)).toEqual(['same']);
    });

    it('keeps local active records when the user keeps existing duplicates', () => {
        const result = applyActiveTaskImport(
            state({
                active: [todo('active', { title: 'local active' })],
                archived: [todo('archived', { title: 'local archive', completed: true })],
            }),
            [todo('active', { title: 'backup active' })],
            'keep-existing',
            NOW,
        );

        expect(result.active).toEqual([
            expect.objectContaining({ id: 'active', title: 'local active' }),
        ]);
        expect(result.archived).toEqual([expect.objectContaining({ id: 'archived' })]);
    });

    it('replaces local active duplicates with imported active tasks when requested', () => {
        const result = applyActiveTaskImport(
            state({
                active: [todo('active', { title: 'local active' })],
                archived: [todo('archived', { title: 'local archive', completed: true })],
            }),
            [todo('active', { title: 'backup active' })],
            'keep-imported',
            NOW,
        );

        expect(result.active.map((entry) => [entry.id, entry.title])).toEqual([
            ['active', 'backup active'],
        ]);
        expect(result.archived).toEqual([expect.objectContaining({ id: 'archived' })]);
    });

    it('keeps both versions of an active duplicate when requested', () => {
        const result = applyActiveTaskImport(
            state({ active: [todo('same', { title: 'local task' })] }),
            [todo('same', { title: 'imported task' })],
            'keep-both',
            NOW,
        );

        expect(result.active).toHaveLength(2);
        expect(result.active.map((entry) => entry.title).sort()).toEqual([
            'imported task',
            'local task',
        ]);
        expect(new Set(result.active.map((entry) => entry.id)).size).toBe(2);
    });

    it('imports non-conflicting tasks alongside duplicates when existing versions are kept', () => {
        const result = applyActiveTaskImport(
            state({ active: [todo('same', { title: 'existing' })] }),
            [todo('same', { title: 'imported' }), todo('new')],
            'keep-existing',
            NOW,
        );

        expect(result.active.map((entry) => entry.id).sort()).toEqual(['new', 'same']);
    });

    it('replaces every title-matched active task when imported versions are kept', () => {
        const result = applyActiveTaskImport(
            state({
                active: [
                    todo('old-1', { title: 'Repeated' }),
                    todo('old-2', { title: ' repeated ' }),
                ],
            }),
            [todo('new', { title: 'REPEATED' })],
            'keep-imported',
            NOW,
        );

        expect(result.active).toEqual([expect.objectContaining({ id: 'new', title: 'REPEATED' })]);
    });

    it('does not mutate either input state while resolving conflicts', () => {
        const current = state({ active: [todo('same')] });
        const imported = [todo('same', { title: 'imported' })];
        const currentBefore = structuredClone(current);
        const importedBefore = structuredClone(imported);

        applyActiveTaskImport(current, imported, 'keep-both', NOW);

        expect(current).toEqual(currentBefore);
        expect(imported).toEqual(importedBefore);
    });

    it('revives an imported active task even when its ID has an old tombstone', () => {
        const result = applyActiveTaskImport(
            state({ tombstones: { restored: NOW - 1 } }),
            [todo('restored')],
            'keep-existing',
            NOW,
        );

        expect(result.active).toEqual([
            expect.objectContaining({ id: 'restored', updatedAt: NOW }),
        ]);
        expect(result.tombstones).toEqual({});
    });
});

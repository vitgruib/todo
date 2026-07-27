import { afterEach, describe, expect, it } from 'vitest';
import {
    getLocalAndSync,
    isSyncSnapshotChange,
    replaceSyncedSnapshot,
    setSyncPreference,
    SYNC_MANIFEST_KEY,
} from './storage';

type TestStorage = Record<string, unknown>;

const installSyncStorage = (options: { failSnapshotWrite?: boolean } = {}) => {
    const values: TestStorage = {};
    const operations: string[] = [];
    let lastError: chrome.runtime.LastError | undefined;
    const sync = {
        get: (keys: string[], callback: (result: TestStorage) => void) => {
            callback(Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])));
        },
        set: (items: TestStorage, callback: () => void) => {
            const isManifestWrite = SYNC_MANIFEST_KEY in items;
            operations.push(isManifestWrite ? 'manifest' : 'snapshot');
            if (options.failSnapshotWrite && !isManifestWrite) {
                lastError = { message: 'sync quota exceeded' };
                callback();
                lastError = undefined;
                return;
            }
            Object.assign(values, items);
            callback();
        },
        remove: (keys: string[], callback: () => void) => {
            operations.push('remove');
            keys.forEach((key) => delete values[key]);
            callback();
        },
    };
    const local = {
        get: (keys: string[], callback: (result: TestStorage) => void) => {
            callback(Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])));
        },
        set: (items: TestStorage, callback: () => void) => {
            Object.assign(values, items);
            callback();
        },
    };
    Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: {
            runtime: {
                get lastError() {
                    return lastError;
                },
            },
            storage: { local, sync },
        },
    });
    return { operations, values };
};

afterEach(() => {
    Reflect.deleteProperty(globalThis, 'chrome');
});

describe('isSyncSnapshotChange', () => {
    it('recognizes a manifest switch', () => {
        expect(isSyncSnapshotChange({ [SYNC_MANIFEST_KEY]: {} })).toBe(true);
    });

    it('recognizes a versioned task snapshot update', () => {
        expect(
            isSyncSnapshotChange({ 'todo-ai-sync-snapshot-v1:version:todo-ai-data-v2': {} }),
        ).toBe(true);
    });

    it('ignores unrelated synced settings', () => {
        expect(isSyncSnapshotChange({ 'todo-ai-alarm-sound-v2': {} })).toBe(false);
    });
});

describe('replaceSyncedSnapshot', () => {
    it('publishes the manifest only after the full snapshot is written', () => {
        const { operations, values } = installSyncStorage();
        let publishedVersion: string | null | undefined;

        replaceSyncedSnapshot({ tasks: [{ id: 'task-1' }], archive: [] }, (version) => {
            publishedVersion = version;
        });

        expect(publishedVersion).toMatch(/^.+$/);
        expect(operations).toEqual(['snapshot', 'manifest']);
        expect(values[SYNC_MANIFEST_KEY]).toBe(publishedVersion);
    });

    it('does not publish a manifest when the snapshot write is rejected', () => {
        const { operations, values } = installSyncStorage({ failSnapshotWrite: true });
        let publishedVersion: string | null | undefined;

        replaceSyncedSnapshot({ tasks: [{ id: 'task-1' }] }, (version) => {
            publishedVersion = version;
        });

        expect(publishedVersion).toBeNull();
        expect(operations).toEqual(['snapshot']);
        expect(values[SYNC_MANIFEST_KEY]).toBeUndefined();
    });

    it('falls back to local data when a published snapshot is incomplete', () => {
        const { values } = installSyncStorage();
        values[SYNC_MANIFEST_KEY] = 'incomplete';
        values['todo-ai-data-v2'] = [{ id: 'local-task' }];
        let received: { local: TestStorage; synced: TestStorage } | undefined;

        setSyncPreference(true, () => {
            getLocalAndSync(
                ['todo-ai-data-v2', 'todo-ai-archive-v1', 'todo-ai-tombstones-v1'],
                (local, synced) => {
                    received = { local, synced };
                },
            );
        });

        expect(received).toEqual({
            local: { 'todo-ai-data-v2': [{ id: 'local-task' }] },
            synced: {},
        });
        setSyncPreference(false);
    });
});

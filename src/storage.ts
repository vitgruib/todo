// Cross-device storage helpers.
//
// Data is written to chrome.storage.sync so it follows the user's Chrome account across computers
// (when they're signed into Chrome with sync on). chrome.storage.local is an automatic fallback:
// if a value is too big for sync's per-key quota, it's kept on this device only. Reads prefer the
// synced value and fall back to the local copy for any key that isn't in sync.
//
// Callers must confirm chrome.storage is available before using these.

type StorageResult = { [key: string]: unknown };
export const SYNC_MANIFEST_KEY = 'todo-ai-sync-manifest-v1';
const SYNC_SNAPSHOT_PREFIX = 'todo-ai-sync-snapshot-v1';
const SYNC_GENERATION_KEY = 'todo-ai-sync-generation-v1';
let syncVersion: string | null = null;

const snapshotKey = (version: string, key: string) => `${SYNC_SNAPSHOT_PREFIX}:${version}:${key}`;
const makeVersion = () => globalThis.crypto.randomUUID();

export const isSyncSnapshotChange = (changes: Record<string, unknown>): boolean =>
    SYNC_MANIFEST_KEY in changes ||
    Object.keys(changes).some((key) => key.startsWith(`${SYNC_SNAPSHOT_PREFIX}:`));

// Whether this device mirrors data to the browser's sync store. Off by default: data stays on this
// device until the user opts in. Stored in LOCAL storage (never synced) so it's a per-device choice.
const SYNC_ENABLED_KEY = 'todo-ai-sync-enabled-v1';
let syncEnabled = false;

export const isSyncEnabled = (): boolean => syncEnabled;

/** Load this device's sync preference; must run before task data is read or written. */
export const loadSyncPreference = (callback: (enabled: boolean) => void): void => {
    chrome.storage.local.get([SYNC_ENABLED_KEY], (result) => {
        void chrome.runtime.lastError;
        syncEnabled = result[SYNC_ENABLED_KEY] === true;
        callback(syncEnabled);
    });
};

export const setSyncPreference = (enabled: boolean, callback?: () => void): void => {
    syncEnabled = enabled;
    chrome.storage.local.set({ [SYNC_ENABLED_KEY]: enabled }, () => {
        void chrome.runtime.lastError;
        callback?.();
    });
};

export const hasSyncedSnapshot = (callback: (exists: boolean) => void): void => {
    chrome.storage.sync.get([SYNC_MANIFEST_KEY], (result) => {
        const version = result[SYNC_MANIFEST_KEY];
        callback(typeof version === 'string' && version.length > 0);
    });
};

export const replaceSyncedSnapshot = (
    items: StorageResult,
    callback?: (version: string | null) => void,
): void => {
    const version = makeVersion();
    const snapshot = Object.fromEntries(
        Object.entries(items).map(([key, value]) => [snapshotKey(version, key), value]),
    );
    chrome.storage.sync.get([SYNC_MANIFEST_KEY], (existing) => {
        const previousVersion = existing[SYNC_MANIFEST_KEY];
        chrome.storage.sync.set(snapshot, () => {
            if (chrome.runtime.lastError) {
                callback?.(null);
                return;
            }
            chrome.storage.sync.set({ [SYNC_MANIFEST_KEY]: version }, () => {
                if (chrome.runtime.lastError) {
                    chrome.storage.sync.remove(Object.keys(snapshot), () => {
                        void chrome.runtime.lastError;
                    });
                    callback?.(null);
                    return;
                }
                syncVersion = version;
                if (typeof previousVersion === 'string' && previousVersion !== version) {
                    chrome.storage.sync.remove(
                        Object.keys(items).map((key) => snapshotKey(previousVersion, key)),
                        () => void chrome.runtime.lastError,
                    );
                }
                callback?.(version);
            });
        });
    });
};

/** Remove keys from the sync store (used when the user turns syncing off) so nothing is left there. */
export const clearSynced = (keys: string[], callback?: () => void): void => {
    chrome.storage.sync.get([SYNC_MANIFEST_KEY], (result) => {
        const version = result[SYNC_MANIFEST_KEY];
        const removals = [SYNC_MANIFEST_KEY];
        if (typeof version === 'string') {
            removals.push(...keys.map((key) => snapshotKey(version, key)));
        }
        chrome.storage.sync.remove(removals, () => {
            void chrome.runtime.lastError;
            syncVersion = null;
            callback?.();
        });
    });
};

/** Read keys, preferring the synced value and falling back to local for anything not in sync. */
export const syncGet = (keys: string[], callback: (result: StorageResult) => void): void => {
    chrome.storage.sync.get(keys, (synced) => {
        void chrome.runtime.lastError;
        const missing = keys.filter((key) => !(key in synced));
        if (missing.length === 0) {
            callback(synced);
            return;
        }
        chrome.storage.local.get(missing, (local) => {
            void chrome.runtime.lastError;
            callback({ ...local, ...synced });
        });
    });
};

/**
 * Read the same keys from BOTH areas and hand both back. Used for task data, where local is a
 * durable per-device copy and sync is the shared channel — the caller merges them (see merge.ts),
 * so a value only in local (too big to sync) or a stale sync copy is resolved correctly.
 */
export const getLocalAndSync = (
    keys: string[],
    callback: (local: StorageResult, synced: StorageResult) => void,
): void => {
    // Syncing off → this device's data is local-only; report an empty sync side.
    if (!syncEnabled) {
        chrome.storage.local.get(keys, (local) => {
            void chrome.runtime.lastError;
            callback(local, {});
        });
        return;
    }
    chrome.storage.local.get(keys, (local) => {
        void chrome.runtime.lastError;
        chrome.storage.sync.get([SYNC_MANIFEST_KEY], (manifest) => {
            const version = manifest[SYNC_MANIFEST_KEY];
            if (typeof version !== 'string') {
                callback(local, {});
                return;
            }
            const taskKeys = keys.filter((key) => key !== SYNC_GENERATION_KEY);
            chrome.storage.sync.get(taskKeys.map((key) => snapshotKey(version, key)), (snapshot) => {
                const isComplete = taskKeys.every((key) => snapshotKey(version, key) in snapshot);
                if (chrome.runtime.lastError || !isComplete) {
                    syncVersion = null;
                    callback(local, {});
                    return;
                }
                const synced: StorageResult = { [SYNC_GENERATION_KEY]: version };
                for (const key of taskKeys) synced[key] = snapshot[snapshotKey(version, key)];
                syncVersion = version;
                callback(local, synced);
            });
        });
    });
};

/**
 * Write to local (always, durable) and sync (best-effort; may reject an oversized value).
 * Both writes are issued immediately and in parallel, so the sync push — the one other computers
 * are waiting on — never sits behind the local write.
 */
export const setLocalAndSync = (items: StorageResult, callback?: () => void): void => {
    // Syncing off → write to this device only; nothing leaves the machine.
    if (!syncEnabled) {
        chrome.storage.local.set(items, () => {
            void chrome.runtime.lastError;
            callback?.();
        });
        return;
    }
    let pending = 2;
    const done = () => {
        pending -= 1;
        if (pending === 0) callback?.();
    };
    chrome.storage.local.set(items, () => {
        void chrome.runtime.lastError;
        done();
    });
    if (!syncVersion) {
        chrome.storage.sync.get([SYNC_MANIFEST_KEY], (manifest) => {
            const version = manifest[SYNC_MANIFEST_KEY];
            syncVersion = typeof version === 'string' ? version : null;
            if (!syncVersion) {
                callback?.();
                return;
            }
            setLocalAndSync(items, callback);
        });
        return;
    }
    const snapshot = Object.fromEntries(
        Object.entries(items).map(([key, value]) => [snapshotKey(syncVersion as string, key), value]),
    );
    chrome.storage.sync.set(snapshot, () => {
        void chrome.runtime.lastError;
        done();
    });
};

/**
 * Write items to sync so they follow the account. If sync rejects the write (usually the per-key
 * ~8KB quota), keep the value on this device in local storage instead and drop any stale synced
 * copy. On success, clear any local shadow so a future read can't pick up an outdated value.
 */
export const syncSet = (items: StorageResult, callback?: () => void): void => {
    const keys = Object.keys(items);
    chrome.storage.sync.set(items, () => {
        if (chrome.runtime.lastError) {
            chrome.storage.local.set(items, () => void chrome.runtime.lastError);
            chrome.storage.sync.remove(keys, () => {
                void chrome.runtime.lastError;
                callback?.();
            });
        } else {
            chrome.storage.local.remove(keys, () => {
                void chrome.runtime.lastError;
                callback?.();
            });
        }
    });
};

// Logged on load so you can confirm in the service-worker console which build is actually running.
const BUILD_VERSION =
    (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.().version) || 'unknown';
console.log(`[Todo] background service worker loaded — v${BUILD_VERSION}`);

const ALARM_SOUND_KEY = 'todo-ai-alarm-sound-v2';
const ALARM_SOUND_OPTIONS = ['alarm', 'ding', 'happy', 'hard-clock', 'chime'];
const DEFAULT_ALARM_SOUND = 'alarm';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const PLAY_SOUND_MESSAGE_TYPE = 'todo-ai-play-alarm-sound';
const REMINDER_ALARM_PREFIX = 'todo-ai-reminder-';
const SCHEDULE_REMINDER_MESSAGE_TYPE = 'todo-ai-schedule-reminder';
const CLEAR_REMINDER_MESSAGE_TYPE = 'todo-ai-clear-reminder';
const SET_RENAG_PERIOD_MESSAGE_TYPE = 'todo-ai-set-renag-period';
// User-configurable: how often a closed-but-unaddressed reminder pops back up. 0 => show once.
const RENAG_PERIOD_KEY = 'todo-ai-renag-period-v1';
// Session-scoped id of the current reminder popup window, so we can close it before opening a fresh
// one without needing the "tabs" permission to read window URLs.
const REMINDER_WINDOW_ID_KEY = 'todo-ai-reminder-window-id';
// Where the app persists the active task list; the background reads it to verify an alarm
// still maps to a genuinely-due task before opening anything.
const TODO_STORAGE_KEY = 'todo-ai-data-v2';
let creatingOffscreenDocument = null;
// Guards against concurrent alarm firings each spawning their own popup — only one
// open/replace cycle may run at a time, so the timer can never leave >1 extra window.
let openingReminderWindow = false;
const REMINDER_POPUP_WIDTH = 420;
const REMINDER_POPUP_HEIGHT = 640;
// Default cadence at which a due reminder re-opens until it's completed, rescheduled, or relegated.
const DEFAULT_RENAG_PERIOD_MINUTES = 5;

// Read keys preferring the synced (cross-device) value, falling back to the local copy for any key
// not in sync. Mirrors src/storage.ts so the worker sees the same data the UI does.
function readStored(keys, callback) {
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
}

// Tasks are always mirrored into this device's local store by the app. Reading them locally keeps
// reminders aligned with the selected snapshot and avoids legacy/shared task keys.
function readLocalTasks(callback) {
    chrome.storage.local.get([TODO_STORAGE_KEY], (result) => {
        void chrome.runtime.lastError;
        callback(result);
    });
}

// Read the user's re-nag cadence (minutes; 0 = show once). Falls back to the default if unset/invalid.
function getRenagPeriodMinutes(callback) {
    readStored([RENAG_PERIOD_KEY], (result) => {
        const v = result[RENAG_PERIOD_KEY];
        callback(
            typeof v === 'number' && Number.isFinite(v) && v >= 0
                ? v
                : DEFAULT_RENAG_PERIOD_MINUTES,
        );
    });
}

// Alarm options for a reminder: repeat every `periodMinutes`, or fire just once when it's 0.
function reminderAlarmOptions(when, periodMinutes) {
    return periodMinutes > 0 ? { when, periodInMinutes: periodMinutes } : { when };
}

function normalizeAlarmSound(value) {
    if (typeof value !== 'string') {
        return DEFAULT_ALARM_SOUND;
    }

    return ALARM_SOUND_OPTIONS.includes(value) ? value : DEFAULT_ALARM_SOUND;
}

/** Reminders must be addressed, so each nag closes the previous reminder popup window (tracked by id
 * in session storage) and opens a fresh one, so it can't be ignored in the background. */
function openReminderPopupWindow() {
    // If an open/replace cycle is already underway, bail — otherwise two alarms firing close
    // together (multiple due tasks, or a re-nag overlapping the first open) would each spawn a
    // window, leaving more than one open.
    if (openingReminderWindow) {
        return;
    }
    openingReminderWindow = true;

    const tabViewUrl = chrome.runtime.getURL('index.html?view=tab');

    const createFreshWindow = () => {
        chrome.windows.create(
            {
                url: tabViewUrl,
                type: 'popup',
                width: REMINDER_POPUP_WIDTH,
                height: REMINDER_POPUP_HEIGHT,
                focused: true,
            },
            (win) => {
                void chrome.runtime.lastError;
                // Remember this window so the next reminder can replace it instead of stacking up.
                chrome.storage.session.set({ [REMINDER_WINDOW_ID_KEY]: win?.id ?? null });
                openingReminderWindow = false;
            },
        );
    };

    // Close the previous reminder window (if it still exists), then pop a fresh one so it grabs
    // attention again. Reading the stored id avoids needing "tabs" to inspect window URLs.
    chrome.storage.session.get([REMINDER_WINDOW_ID_KEY], (result) => {
        const prevId = result[REMINDER_WINDOW_ID_KEY];
        if (typeof prevId === 'number') {
            chrome.windows.remove(prevId, () => {
                void chrome.runtime.lastError; // ignore if the user already closed it
                createFreshWindow();
            });
        } else {
            createFreshWindow();
        }
    });
}

async function hasOffscreenDocument() {
    const offscreenDocumentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

    if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [offscreenDocumentUrl],
        });
        return contexts.length > 0;
    }

    const clients = await self.clients.matchAll();
    return clients.some((client) => client.url === offscreenDocumentUrl);
}

async function ensureOffscreenDocument() {
    if (!chrome.offscreen || !chrome.offscreen.createDocument) {
        return false;
    }

    if (await hasOffscreenDocument()) {
        return true;
    }

    if (!creatingOffscreenDocument) {
        creatingOffscreenDocument = chrome.offscreen
            .createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'Play an alarm sound when a reminder fires.',
            })
            .finally(() => {
                creatingOffscreenDocument = null;
            });
    }

    await creatingOffscreenDocument;
    return true;
}

async function playAlarmSound() {
    try {
        const offscreenReady = await ensureOffscreenDocument();
        if (!offscreenReady) {
            return;
        }

        readStored([ALARM_SOUND_KEY], (result) => {
            const sound = normalizeAlarmSound(result[ALARM_SOUND_KEY]);
            chrome.runtime
                .sendMessage({
                    type: PLAY_SOUND_MESSAGE_TYPE,
                    sound,
                })
                .catch((error) => {
                    console.error('Failed to send alarm sound message:', error);
                });
        });
    } catch (error) {
        console.error('Failed to play alarm sound:', error);
    }
}

/** Read the active task list from storage (empty array if unset/corrupt). */
function getActiveTodos(callback) {
    readLocalTasks((result) => {
        const list = result[TODO_STORAGE_KEY];
        callback(Array.isArray(list) ? list : []);
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(REMINDER_ALARM_PREFIX)) {
        return;
    }

    // Never open blindly: an alarm can be stale (its task was completed/deleted, or pushed back to
    // a later time) yet keep firing on its 5-minute repeat. Check the real task before doing anything.
    const taskId = alarm.name.slice(REMINDER_ALARM_PREFIX.length);
    getActiveTodos((todos) => {
        const task = todos.find((t) => t && t.id === taskId);

        // Task gone or already completed → the alarm is orphaned; kill it so it stops nagging.
        if (!task || task.completed === true || typeof task.remindAt !== 'number') {
            console.log(
                `[Todo] v${BUILD_VERSION}: suppressing orphaned reminder ${taskId} (cleared)`,
            );
            chrome.alarms.clear(alarm.name, () => void chrome.runtime.lastError);
            return;
        }

        // Task still pending but not due yet (e.g. pushed back) → re-sync the alarm to the correct
        // time so it fires then instead of now, and open nothing.
        if (task.remindAt > Date.now()) {
            console.log(
                `[Todo] v${BUILD_VERSION}: suppressing not-yet-due reminder ${taskId}; re-syncing to ${new Date(task.remindAt).toLocaleString()}`,
            );
            getRenagPeriodMinutes((period) => {
                chrome.alarms.create(alarm.name, reminderAlarmOptions(task.remindAt, period));
            });
            return;
        }

        // Genuinely due: force-open a focused popup window and keep re-nagging until it's addressed.
        console.log(`[Todo] v${BUILD_VERSION}: opening reminder window for overdue task ${taskId}`);
        openReminderPopupWindow();
        void playAlarmSound();
    });
});

/**
 * On startup/install, scrub the persisted-alarm backlog against reality: drop any reminder alarm
 * whose task is gone/completed, and re-create alarms for still-pending tasks at their correct time.
 * This clears out orphaned alarms accumulated from earlier sessions.
 */
function reconcileReminderAlarms(periodOverride) {
    getActiveTodos((todos) => {
        getRenagPeriodMinutes((storedPeriod) => {
            const period = typeof periodOverride === 'number' ? periodOverride : storedPeriod;
            const wanted = new Map(
                todos
                    .filter((t) => t && t.completed !== true && typeof t.remindAt === 'number')
                    .map((t) => [REMINDER_ALARM_PREFIX + t.id, t.remindAt]),
            );

            chrome.alarms.getAll((alarms) => {
                alarms.forEach((alarm) => {
                    if (alarm.name.startsWith(REMINDER_ALARM_PREFIX) && !wanted.has(alarm.name)) {
                        chrome.alarms.clear(alarm.name, () => void chrome.runtime.lastError);
                    }
                });

                wanted.forEach((remindAt, name) => {
                    chrome.alarms.create(name, reminderAlarmOptions(remindAt, period));
                });
            });
        });
    });
}

chrome.runtime.onStartup.addListener(reconcileReminderAlarms);
chrome.runtime.onInstalled.addListener(reconcileReminderAlarms);

/** Map of taskId → remindAt for every pending (not completed, has a reminder) task in a list. */
function pendingReminderMap(list) {
    const map = new Map();
    (Array.isArray(list) ? list : []).forEach((t) => {
        if (t && t.completed !== true && typeof t.remindAt === 'number') {
            map.set(t.id, t.remindAt);
        }
    });
    return map;
}

// Keep this device's alarms in step with the task list the instant it changes — including a change
// synced from another computer. We diff old vs new so only reminders that actually changed are
// touched: a task added/rescheduled anywhere arms the alarm here (so it pops on every running
// device), and a task finished/snoozed/deleted anywhere clears or moves the alarm here (whichever
// device you acted on wins). Unchanged reminders are left alone, so nothing re-fires.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    const change = changes[TODO_STORAGE_KEY];
    // Ignore syncSet's cleanup removals (newValue undefined); an empty list is stored as [].
    if (!change || change.newValue === undefined) return;

    const oldMap = pendingReminderMap(change.oldValue);
    const newMap = pendingReminderMap(change.newValue);
    getRenagPeriodMinutes((period) => {
        // New or rescheduled reminder → (re)create the alarm at its current time.
        newMap.forEach((remindAt, id) => {
            if (oldMap.get(id) !== remindAt) {
                chrome.alarms.create(
                    REMINDER_ALARM_PREFIX + id,
                    reminderAlarmOptions(remindAt, period),
                );
            }
        });
        // Reminder gone (finished / deleted / relegated) → clear the alarm.
        oldMap.forEach((_remindAt, id) => {
            if (!newMap.has(id)) {
                chrome.alarms.clear(
                    REMINDER_ALARM_PREFIX + id,
                    () => void chrome.runtime.lastError,
                );
            }
        });
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === SCHEDULE_REMINDER_MESSAGE_TYPE) {
        const taskId = typeof message.taskId === 'string' ? message.taskId.trim() : '';
        const remindAt =
            typeof message.remindAt === 'number' && Number.isFinite(message.remindAt)
                ? message.remindAt
                : 0;
        if (!taskId || remindAt <= 0) {
            sendResponse({ ok: false, error: 'Invalid schedule-reminder payload.' });
            return false;
        }
        const alarmName = REMINDER_ALARM_PREFIX + taskId;
        chrome.alarms.clear(alarmName, () => {
            getRenagPeriodMinutes((period) => {
                chrome.alarms.create(alarmName, reminderAlarmOptions(remindAt, period));
                sendResponse({ ok: true });
            });
        });
        return true;
    }

    if (message?.type === SET_RENAG_PERIOD_MESSAGE_TYPE) {
        // The app already persisted the new cadence; re-apply it to every pending alarm right away
        // so an active re-nag loop picks up the change without waiting for a restart.
        const minutes =
            typeof message.minutes === 'number' &&
            Number.isFinite(message.minutes) &&
            message.minutes >= 0
                ? message.minutes
                : DEFAULT_RENAG_PERIOD_MINUTES;
        reconcileReminderAlarms(minutes);
        sendResponse({ ok: true });
        return false;
    }

    if (message?.type === CLEAR_REMINDER_MESSAGE_TYPE) {
        const taskId = typeof message.taskId === 'string' ? message.taskId.trim() : '';
        if (!taskId) {
            sendResponse({ ok: false, error: 'Missing taskId.' });
            return false;
        }
        chrome.alarms.clear(REMINDER_ALARM_PREFIX + taskId, () => {
            sendResponse({ ok: true });
        });
        return true;
    }

    return undefined;
});

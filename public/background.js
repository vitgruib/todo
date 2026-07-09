const ALARM_SOUND_KEY = 'todo-ai-alarm-sound-v2';
const ALARM_SOUND_OPTIONS = ['alarm', 'ding', 'happy', 'hard-clock', 'chime'];
const DEFAULT_ALARM_SOUND = 'alarm';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const PLAY_SOUND_MESSAGE_TYPE = 'todo-ai-play-alarm-sound';
const REMINDER_ALARM_PREFIX = 'todo-ai-reminder-';
const SCHEDULE_REMINDER_MESSAGE_TYPE = 'todo-ai-schedule-reminder';
const CLEAR_REMINDER_MESSAGE_TYPE = 'todo-ai-clear-reminder';
let creatingOffscreenDocument = null;
const REMINDER_POPUP_WIDTH = 420;
const REMINDER_POPUP_HEIGHT = 640;
// A due reminder keeps re-opening its popup at this cadence until it's completed, rescheduled, or relegated.
const REMINDER_RENAG_PERIOD_MINUTES = 5;

function normalizeAlarmSound(value) {
    if (typeof value !== 'string') {
        return DEFAULT_ALARM_SOUND;
    }

    return ALARM_SOUND_OPTIONS.includes(value) ? value : DEFAULT_ALARM_SOUND;
}

/** Reminders must be addressed, so each nag closes any existing reminder popup window(s) and opens a fresh one, so it can't be ignored in the background. */
function openReminderPopupWindow() {
    const extensionPageBaseUrl = chrome.runtime.getURL('index.html');
    const tabViewUrl = chrome.runtime.getURL('index.html?view=tab');

    const createFreshWindow = () => {
        chrome.windows.create({
            url: tabViewUrl,
            type: 'popup',
            width: REMINDER_POPUP_WIDTH,
            height: REMINDER_POPUP_HEIGHT,
            focused: true,
        });
    };

    chrome.windows.getAll({ populate: true }, (windows) => {
        const existingIds = windows
            .filter(
                (win) =>
                    win.type === 'popup' &&
                    win.id !== undefined &&
                    win.tabs?.some(
                        (tab) =>
                            typeof tab.url === 'string' && tab.url.startsWith(extensionPageBaseUrl),
                    ),
            )
            .map((win) => win.id);

        if (existingIds.length === 0) {
            createFreshWindow();
            return;
        }

        // Close the stale reminder window(s) first, then pop a fresh one so it grabs attention again.
        let remaining = existingIds.length;
        existingIds.forEach((id) => {
            chrome.windows.remove(id, () => {
                void chrome.runtime.lastError;
                remaining -= 1;
                if (remaining === 0) {
                    createFreshWindow();
                }
            });
        });
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

        chrome.storage.local.get([ALARM_SOUND_KEY], (result) => {
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

chrome.alarms.onAlarm.addListener((alarm) => {
    // "Do now" reminder: force-open a focused popup window, and keep re-nagging (the alarm below
    // is created with a repeat period) until it's addressed — each nag closes and reopens the window.
    if (alarm.name.startsWith(REMINDER_ALARM_PREFIX)) {
        openReminderPopupWindow();
        void playAlarmSound();
    }
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
            chrome.alarms.create(alarmName, {
                when: remindAt,
                periodInMinutes: REMINDER_RENAG_PERIOD_MINUTES,
            });
            sendResponse({ ok: true });
        });
        return true;
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

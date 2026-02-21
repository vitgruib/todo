const INTERVAL_MINUTES_KEY = 'todo-ai-auto-open-interval-minutes';
const ALARM_SOUND_KEY = 'todo-ai-alarm-sound';
const DEFAULT_INTERVAL_MINUTES = 120;
const MIN_INTERVAL_MINUTES = 1;
const ALARM_SOUND_OPTIONS = ['alarm', 'ding', 'happy', 'hard-clock', 'chime'];
const DEFAULT_ALARM_SOUND = 'alarm';
const ALARM_NAME = 'todo-ai-auto-open-alarm';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const PLAY_SOUND_MESSAGE_TYPE = 'todo-ai-play-alarm-sound';
let creatingOffscreenDocument = null;

function normalizeIntervalMinutes(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_INTERVAL_MINUTES;
    }

    return Math.max(MIN_INTERVAL_MINUTES, Math.round(value));
}

function scheduleAlarm(intervalMinutes) {
    chrome.alarms.clear(ALARM_NAME, () => {
        chrome.alarms.create(ALARM_NAME, {
            delayInMinutes: intervalMinutes,
            periodInMinutes: intervalMinutes,
        });
    });
}

function normalizeAlarmSound(value) {
    if (typeof value !== 'string') {
        return DEFAULT_ALARM_SOUND;
    }

    return ALARM_SOUND_OPTIONS.includes(value) ? value : DEFAULT_ALARM_SOUND;
}

function hydrateSettingsAndSchedule() {
    chrome.storage.local.get([INTERVAL_MINUTES_KEY, ALARM_SOUND_KEY], (result) => {
        const intervalMinutes = normalizeIntervalMinutes(result[INTERVAL_MINUTES_KEY]);
        const alarmSound = normalizeAlarmSound(result[ALARM_SOUND_KEY]);
        const updates = {};

        if (result[INTERVAL_MINUTES_KEY] !== intervalMinutes) {
            updates[INTERVAL_MINUTES_KEY] = intervalMinutes;
        }

        if (result[ALARM_SOUND_KEY] !== alarmSound) {
            updates[ALARM_SOUND_KEY] = alarmSound;
        }

        if (Object.keys(updates).length > 0) {
            chrome.storage.local.set(updates);
        }

        scheduleAlarm(intervalMinutes);
    });
}

function openOrFocusExtensionPage() {
    const tabViewUrl = chrome.runtime.getURL('index.html?view=tab');
    const extensionPageBaseUrl = chrome.runtime.getURL('index.html');

    chrome.tabs.query({}, (tabs) => {
        const firstMatch = tabs.find((tab) =>
            typeof tab.url === 'string' && tab.url.startsWith(extensionPageBaseUrl)
        );

        if (firstMatch && firstMatch.id !== undefined) {
            chrome.tabs.update(firstMatch.id, { active: true, url: tabViewUrl });
            return;
        }

        chrome.tabs.create({ url: tabViewUrl });
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
        creatingOffscreenDocument = chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play an alarm sound when the auto-open interval finishes.',
        }).finally(() => {
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
            chrome.runtime.sendMessage({
                type: PLAY_SOUND_MESSAGE_TYPE,
                sound,
            }).catch((error) => {
                console.error('Failed to send alarm sound message:', error);
            });
        });
    } catch (error) {
        console.error('Failed to play interval alarm sound:', error);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    hydrateSettingsAndSchedule();
});

chrome.runtime.onStartup.addListener(() => {
    hydrateSettingsAndSchedule();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[INTERVAL_MINUTES_KEY]) {
        return;
    }

    const intervalMinutes = normalizeIntervalMinutes(changes[INTERVAL_MINUTES_KEY].newValue);
    scheduleAlarm(intervalMinutes);
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) {
        return;
    }

    openOrFocusExtensionPage();
    void playAlarmSound();
});

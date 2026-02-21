const INTERVAL_MINUTES_KEY = 'todo-ai-auto-open-interval-minutes-v2';
const ALARM_SOUND_KEY = 'todo-ai-alarm-sound-v2';
const DEFAULT_INTERVAL_MINUTES = 120;
const MIN_INTERVAL_MINUTES = 1;
const ALARM_SOUND_OPTIONS = ['alarm', 'ding', 'happy', 'hard-clock', 'chime'];
const DEFAULT_ALARM_SOUND = 'alarm';
const ALARM_NAME = 'todo-ai-auto-open-alarm';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const PLAY_SOUND_MESSAGE_TYPE = 'todo-ai-play-alarm-sound';
const CHAT_REQUEST_MESSAGE_TYPE = 'todo-ai-chat-request';
const CHAT_CANCEL_MESSAGE_TYPE = 'todo-ai-chat-cancel';
const CHAT_RESULTS_KEY = 'todo-ai-chat-results-v2';
const CHECKIN_REQUEST_KEY = 'todo-ai-checkin-request-v1';
const MAX_CHAT_RESULTS = 25;
const CHAT_REQUEST_TIMEOUT_MS = 90_000;
const CHAT_CANCELLED_MESSAGE = 'Request cancelled by user.';
const CHAT_TIMEOUT_MESSAGE = 'Request timed out. Please try again.';
let creatingOffscreenDocument = null;
const activeChatControllers = new Map();

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

function parseJson(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function storageGet(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => resolve(result));
    });
}

function storageSet(items) {
    return new Promise((resolve) => {
        chrome.storage.local.set(items, () => resolve());
    });
}

async function storeChatResult(result) {
    const existingRaw = await storageGet([CHAT_RESULTS_KEY]);
    const existing = existingRaw?.[CHAT_RESULTS_KEY];
    const normalized =
        existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};

    normalized[result.requestId] = result;

    const trimmed = Object.fromEntries(
        Object.entries(normalized)
            .filter(([, value]) => value && typeof value === 'object')
            .sort(([, a], [, b]) => {
                const aTime = typeof a.completedAt === 'number' ? a.completedAt : 0;
                const bTime = typeof b.completedAt === 'number' ? b.completedAt : 0;
                return bTime - aTime;
            })
            .slice(0, MAX_CHAT_RESULTS)
    );

    await storageSet({ [CHAT_RESULTS_KEY]: trimmed });
}

function normalizeChatMessages(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }

    return messages
        .filter((message) => typeof message?.text === 'string' && message.text.trim().length > 0)
        .slice(-10)
        .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            text: String(message.text),
        }));
}

function normalizeTodoContext(todoContext) {
    if (todoContext === null || todoContext === undefined) {
        return null;
    }

    if (typeof todoContext === 'string') {
        const trimmed = todoContext.trim();
        return trimmed.length > 0 ? trimmed.slice(0, 20_000) : null;
    }

    if (typeof todoContext === 'object') {
        try {
            return JSON.stringify(todoContext).slice(0, 20_000);
        } catch {
            return null;
        }
    }

    return null;
}

function normalizeAssistantConfig(config) {
    if (!config || typeof config !== 'object') {
        return null;
    }

    const candidate = config;
    return {
        personality: typeof candidate.personality === 'string' ? candidate.personality : 'normal',
        enableActionProposals: Boolean(candidate.enableActionProposals),
        requireConfirmation: Boolean(candidate.requireConfirmation),
        source: typeof candidate.source === 'string' ? candidate.source : 'user',
    };
}

async function runChatRequest(requestId, proxyUrl, messages, todoContext, assistantConfig) {
    const controller = new AbortController();
    activeChatControllers.set(requestId, controller);
    const timeoutId = setTimeout(() => {
        controller.abort(CHAT_TIMEOUT_MESSAGE);
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, todoContext, assistantConfig }),
            signal: controller.signal,
        });

        const rawText = await response.text();
        const payload = parseJson(rawText);

        if (!response.ok) {
            const errorDetail =
                (payload && typeof payload.error === 'string' && payload.error) ||
                rawText.trim() ||
                `Proxy request failed (${response.status} ${response.statusText})`;
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorDetail}`);
        }

        const text =
            (payload && typeof payload.text === 'string' && payload.text.trim()) ||
            (typeof rawText === 'string' ? rawText.trim() : '');

        return {
            requestId,
            ok: true,
            text: text || 'Proxy returned an empty response.',
            completedAt: Date.now(),
        };
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            const reason = controller.signal?.reason;
            const message = typeof reason === 'string' && reason.trim().length > 0
                ? reason
                : CHAT_CANCELLED_MESSAGE;
            throw new Error(message);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        activeChatControllers.delete(requestId);
    }
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
    chrome.storage.local.set({
        [CHECKIN_REQUEST_KEY]: Date.now(),
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === CHAT_CANCEL_MESSAGE_TYPE) {
        const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
        if (!requestId) {
            sendResponse({ ok: false, error: 'Missing requestId.' });
            return false;
        }

        const controller = activeChatControllers.get(requestId);
        if (!controller) {
            sendResponse({ ok: false, error: 'No active request found.' });
            return false;
        }

        controller.abort(CHAT_CANCELLED_MESSAGE);
        sendResponse({ ok: true });
        return false;
    }

    if (!message || message.type !== CHAT_REQUEST_MESSAGE_TYPE) {
        return undefined;
    }

    const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
    const proxyUrl = typeof message.proxyUrl === 'string' ? message.proxyUrl.trim() : '';
    const messages = normalizeChatMessages(message.messages);
    const todoContext = normalizeTodoContext(message.todoContext);
    const assistantConfig = normalizeAssistantConfig(message.assistantConfig);

    if (!requestId || !proxyUrl || messages.length === 0) {
        sendResponse({ ok: false, error: 'Invalid chat request payload.' });
        return false;
    }

    void (async () => {
        try {
            const result = await runChatRequest(requestId, proxyUrl, messages, todoContext, assistantConfig);
            await storeChatResult(result);
            sendResponse({ ok: true });
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            await storeChatResult({
                requestId,
                ok: false,
                error: messageText || 'Unknown background chat error',
                completedAt: Date.now(),
            });
            sendResponse({ ok: false, error: messageText });
        }
    })();

    return true;
});

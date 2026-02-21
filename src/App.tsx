import { useEffect, useLayoutEffect, useState } from 'react';
import { useTodos } from './hooks/useTodos';
import { TodoList } from './components/TodoList';
import { TodoForm } from './components/TodoForm';
import { CompanionFrame } from './components/CompanionFrame';

const INTERVAL_MINUTES_KEY = 'todo-ai-auto-open-interval-minutes';
const ALARM_SOUND_KEY = 'todo-ai-alarm-sound';
const AI_PROXY_URL_KEY = 'todo-ai-proxy-url';
const DEFAULT_INTERVAL_MINUTES = 120;
const MIN_INTERVAL_MINUTES = 1;
const DEFAULT_PROXY_URL = 'http://localhost:8787/api/chat';
const ALARM_SOUND_OPTIONS = [
    { value: 'alarm', label: 'Alarm' },
    { value: 'ding', label: 'Ding' },
    { value: 'happy', label: 'Happy' },
    { value: 'hard-clock', label: 'Hard Clock' },
    { value: 'chime', label: 'Chime' },
] as const;
type AlarmSoundOption = (typeof ALARM_SOUND_OPTIONS)[number]['value'];
const DEFAULT_ALARM_SOUND: AlarmSoundOption = 'alarm';
const ALARM_SOUND_VALUES = new Set<AlarmSoundOption>(
    ALARM_SOUND_OPTIONS.map((option) => option.value)
);

const normalizeIntervalMinutes = (value: number) => {
    if (!Number.isFinite(value)) {
        return DEFAULT_INTERVAL_MINUTES;
    }

    return Math.max(MIN_INTERVAL_MINUTES, Math.round(value));
};

const normalizeAlarmSound = (value: unknown): AlarmSoundOption => {
    if (typeof value !== 'string') {
        return DEFAULT_ALARM_SOUND;
    }

    return ALARM_SOUND_VALUES.has(value as AlarmSoundOption)
        ? (value as AlarmSoundOption)
        : DEFAULT_ALARM_SOUND;
};

const normalizeProxyUrl = (value: unknown): string => {
    if (typeof value !== 'string') {
        return DEFAULT_PROXY_URL;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return DEFAULT_PROXY_URL;
    }

    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return DEFAULT_PROXY_URL;
        }

        parsed.hash = '';
        if (!parsed.pathname || parsed.pathname === '/') {
            parsed.pathname = '/api/chat';
        }

        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return DEFAULT_PROXY_URL;
    }
};

function App() {
    const isTabMode = new URLSearchParams(window.location.search).get('view') === 'tab';
    const {
        todos,
        addTodo,
        deleteTodo,
        toggleTodo,
        addStep,
        toggleStep,
        reorderTodos,
    } = useTodos();
    const [intervalMinutes, setIntervalMinutes] = useState<number>(DEFAULT_INTERVAL_MINUTES);
    const [alarmSound, setAlarmSound] = useState<AlarmSoundOption>(DEFAULT_ALARM_SOUND);
    const [proxyUrl, setProxyUrl] = useState<string>(DEFAULT_PROXY_URL);
    const [hasLoadedSettings, setHasLoadedSettings] = useState<boolean>(false);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle('tab-mode', isTabMode);
        document.body.classList.toggle('tab-mode', isTabMode);

        return () => {
            document.documentElement.classList.remove('tab-mode');
            document.body.classList.remove('tab-mode');
        };
    }, [isTabMode]);

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([INTERVAL_MINUTES_KEY, ALARM_SOUND_KEY, AI_PROXY_URL_KEY], (result) => {
                const normalizedInterval = normalizeIntervalMinutes(result[INTERVAL_MINUTES_KEY]);
                const normalizedSound = normalizeAlarmSound(result[ALARM_SOUND_KEY]);
                const normalizedProxyUrl = normalizeProxyUrl(result[AI_PROXY_URL_KEY]);
                setIntervalMinutes(normalizedInterval);
                setAlarmSound(normalizedSound);
                setProxyUrl(normalizedProxyUrl);
                setHasLoadedSettings(true);
            });
            return;
        }

        const savedInterval = localStorage.getItem(INTERVAL_MINUTES_KEY);
        if (savedInterval) {
            const normalizedInterval = normalizeIntervalMinutes(Number(savedInterval));
            setIntervalMinutes(normalizedInterval);
        }

        const savedSound = localStorage.getItem(ALARM_SOUND_KEY);
        if (savedSound) {
            const normalizedSound = normalizeAlarmSound(savedSound);
            setAlarmSound(normalizedSound);
        }

        const savedProxyUrl = localStorage.getItem(AI_PROXY_URL_KEY);
        if (savedProxyUrl) {
            const normalizedProxyUrl = normalizeProxyUrl(savedProxyUrl);
            setProxyUrl(normalizedProxyUrl);
        }

        setHasLoadedSettings(true);
    }, []);

    useEffect(() => {
        if (!hasLoadedSettings) {
            return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
                [INTERVAL_MINUTES_KEY]: intervalMinutes,
                [ALARM_SOUND_KEY]: alarmSound,
                [AI_PROXY_URL_KEY]: normalizeProxyUrl(proxyUrl),
            });
            return;
        }

        localStorage.setItem(INTERVAL_MINUTES_KEY, String(intervalMinutes));
        localStorage.setItem(ALARM_SOUND_KEY, alarmSound);
        localStorage.setItem(AI_PROXY_URL_KEY, normalizeProxyUrl(proxyUrl));
    }, [alarmSound, hasLoadedSettings, intervalMinutes, proxyUrl]);

    const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const parsed = Number(e.target.value);
        setIntervalMinutes(normalizeIntervalMinutes(parsed));
    };

    const handleAlarmSoundChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setAlarmSound(normalizeAlarmSound(e.target.value));
    };

    const handleProxyUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProxyUrl(e.target.value);
    };

    const handleProxyUrlBlur = () => {
        setProxyUrl(normalizeProxyUrl(proxyUrl));
    };

    const openFullScreenView = () => {
        const tabViewUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('index.html?view=tab')
            : `${window.location.pathname}?view=tab`;

        if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
            chrome.tabs.create({ url: tabViewUrl });
            return;
        }

        window.open(tabViewUrl, '_blank', 'noopener,noreferrer');
    };

    const resolvedProxyUrl = normalizeProxyUrl(proxyUrl);

    return (
        <div className="app-container">
            <div className="main-content">
                <header className="app-header">
                    <div className="header-top">
                        <h1>Todo AI</h1>
                        {!isTabMode && (
                            <button
                                type="button"
                                className="open-tab-btn"
                                onClick={openFullScreenView}
                            >
                                Open Full Screen
                            </button>
                        )}
                    </div>
                    <div className="header-settings">
                        <div className="interval-setting">
                            <label htmlFor="intervalMinutes">Auto-open interval (minutes)</label>
                            <input
                                id="intervalMinutes"
                                type="number"
                                min={MIN_INTERVAL_MINUTES}
                                step={1}
                                value={intervalMinutes}
                                onChange={handleIntervalChange}
                            />
                        </div>
                        <div className="interval-setting">
                            <label htmlFor="alarmSound">Alarm sound</label>
                            <select
                                id="alarmSound"
                                value={alarmSound}
                                onChange={handleAlarmSoundChange}
                            >
                                {ALARM_SOUND_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="interval-setting setting-wide">
                            <label htmlFor="proxyUrl">AI proxy URL</label>
                            <input
                                id="proxyUrl"
                                type="url"
                                value={proxyUrl}
                                onChange={handleProxyUrlChange}
                                onBlur={handleProxyUrlBlur}
                                placeholder="https://your-proxy-domain/api/chat"
                            />
                            <p className="setting-hint">Use a hosted HTTPS endpoint so chat works without a local server.</p>
                        </div>
                    </div>
                </header>

                <section className="todo-section">
                    <TodoForm onAdd={addTodo} />
                    <TodoList
                        todos={todos}
                        onReorder={reorderTodos}
                        onToggle={toggleTodo}
                        onDelete={deleteTodo}
                        onAddStep={addStep}
                        onToggleStep={toggleStep}
                    />
                </section>
            </div>

            <aside className="companion-sidebar">
                <CompanionFrame proxyUrl={resolvedProxyUrl} />
            </aside>
        </div>
    );
}

export default App;

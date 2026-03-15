import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTodos } from './hooks/useTodos';
import { TodoList } from './components/TodoList';
import { TodoForm } from './components/TodoForm';
import { CompanionFrame } from './components/CompanionFrame';

const INTERVAL_MINUTES_KEY = 'todo-ai-auto-open-interval-minutes-v2';
const ALARM_SOUND_KEY = 'todo-ai-alarm-sound-v2';
const AI_PERSONALITY_KEY = 'todo-ai-personality-v1';
const FOCUS_BUMP_HOURS_KEY = 'todo-ai-focus-bump-hours-v1';
const DELETE_ON_COMPLETION_KEY = 'todo-ai-delete-on-completion-v1';
const DEFAULT_INTERVAL_MINUTES = 120;
const DEFAULT_FOCUS_BUMP_HOURS = 24;
const MIN_FOCUS_BUMP_HOURS = 1;
const MAX_FOCUS_BUMP_HOURS = 720;
const MIN_INTERVAL_MINUTES = 1;
const ALARM_SOUND_OPTIONS = [
    { value: 'alarm', label: 'Alarm' },
    { value: 'ding', label: 'Ding' },
    { value: 'happy', label: 'Happy' },
    { value: 'hard-clock', label: 'Hard Clock' },
    { value: 'chime', label: 'Chime' },
] as const;
type AlarmSoundOption = (typeof ALARM_SOUND_OPTIONS)[number]['value'];
const PERSONALITY_OPTIONS = [
    { value: 'normal', label: 'Normal' },
    { value: 'endearing', label: 'Endearing' },
    { value: 'caustic', label: 'Caustic' },
] as const;
type PersonalityOption = (typeof PERSONALITY_OPTIONS)[number]['value'];
const DEFAULT_ALARM_SOUND: AlarmSoundOption = 'alarm';
const DEFAULT_PERSONALITY: PersonalityOption = 'normal';
const ALARM_SOUND_VALUES = new Set<AlarmSoundOption>(
    ALARM_SOUND_OPTIONS.map((option) => option.value)
);
const PERSONALITY_VALUES = new Set<PersonalityOption>(
    PERSONALITY_OPTIONS.map((option) => option.value)
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

const normalizePersonality = (value: unknown): PersonalityOption => {
    if (typeof value !== 'string') {
        return DEFAULT_PERSONALITY;
    }
    return PERSONALITY_VALUES.has(value as PersonalityOption)
        ? (value as PersonalityOption)
        : DEFAULT_PERSONALITY;
};

function App() {
    const isTabMode = new URLSearchParams(window.location.search).get('view') === 'tab';
    const {
        todos,
        addTodo,
        deleteTodo,
        toggleTodo,
        updateTodo,
        reorderTodos,
    } = useTodos();
    const [intervalMinutes, setIntervalMinutes] = useState<number>(DEFAULT_INTERVAL_MINUTES);
    const [alarmSound, setAlarmSound] = useState<AlarmSoundOption>(DEFAULT_ALARM_SOUND);
    const [personality, setPersonality] = useState<PersonalityOption>(DEFAULT_PERSONALITY);
    const [focusBumpAfterHours, setFocusBumpAfterHours] = useState<number>(DEFAULT_FOCUS_BUMP_HOURS);
    const [deleteOnCompletion, setDeleteOnCompletion] = useState<boolean>(true);
    const [hasLoadedSettings, setHasLoadedSettings] = useState<boolean>(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
    const [activeTimer, setActiveTimerState] = useState<{ taskId: string; taskTitle: string; endAt: number } | null>(null);
    const [timerTick, setTimerTick] = useState(0);
    const settingsMenuRef = useRef<HTMLDivElement | null>(null);

    const clearActiveTimer = () => setActiveTimerState(null);
    const setActiveTimer = (taskId: string, taskTitle: string, endAt: number) => {
        setActiveTimerState({ taskId, taskTitle, endAt });
    };

    useEffect(() => {
        if (!activeTimer) return;
        const remaining = activeTimer.endAt - Date.now();
        if (remaining <= 0) {
            clearActiveTimer();
            return;
        }
        const t = setTimeout(() => setTimerTick((n) => n + 1), 1000);
        return () => clearTimeout(t);
    }, [activeTimer, timerTick]);

    useEffect(() => {
        if (!activeTimer) return;
        if (Date.now() >= activeTimer.endAt) clearActiveTimer();
    }, [activeTimer, timerTick]);

    const handleStartTimer = (taskId: string, taskTitle: string, timerMinutes: number, checkInCount: number) => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage(
                { type: 'todo-ai-schedule-task-checkins', taskId, taskTitle, timerMinutes, checkInCount },
                () => {}
            );
        }
        setActiveTimer(taskId, taskTitle, Date.now() + timerMinutes * 60 * 1000);
    };

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
            chrome.storage.local.get([INTERVAL_MINUTES_KEY, ALARM_SOUND_KEY, AI_PERSONALITY_KEY, FOCUS_BUMP_HOURS_KEY, DELETE_ON_COMPLETION_KEY], (result) => {
                const normalizedInterval = normalizeIntervalMinutes(result[INTERVAL_MINUTES_KEY]);
                const normalizedSound = normalizeAlarmSound(result[ALARM_SOUND_KEY]);
                const normalizedPersonality = normalizePersonality(result[AI_PERSONALITY_KEY]);
                const rawBump = result[FOCUS_BUMP_HOURS_KEY];
                const bumpHours = Number.isFinite(rawBump) ? Math.max(MIN_FOCUS_BUMP_HOURS, Math.min(MAX_FOCUS_BUMP_HOURS, Math.round(Number(rawBump)))) : DEFAULT_FOCUS_BUMP_HOURS;
                const deleteOnComplete = result[DELETE_ON_COMPLETION_KEY];
                setIntervalMinutes(normalizedInterval);
                setAlarmSound(normalizedSound);
                setPersonality(normalizedPersonality);
                setFocusBumpAfterHours(bumpHours);
                setDeleteOnCompletion(deleteOnComplete === false ? false : true);
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
        const savedPersonality = localStorage.getItem(AI_PERSONALITY_KEY);
        if (savedPersonality) {
            setPersonality(normalizePersonality(savedPersonality));
        }
        const savedBump = localStorage.getItem(FOCUS_BUMP_HOURS_KEY);
        if (savedBump) {
            const n = Number(savedBump);
            if (Number.isFinite(n)) setFocusBumpAfterHours(Math.max(MIN_FOCUS_BUMP_HOURS, Math.min(MAX_FOCUS_BUMP_HOURS, Math.round(n))));
        }
        const savedDeleteOnCompletion = localStorage.getItem(DELETE_ON_COMPLETION_KEY);
        if (savedDeleteOnCompletion !== null) setDeleteOnCompletion(savedDeleteOnCompletion === 'true');

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
                [AI_PERSONALITY_KEY]: personality,
                [FOCUS_BUMP_HOURS_KEY]: focusBumpAfterHours,
                [DELETE_ON_COMPLETION_KEY]: deleteOnCompletion,
            });
            return;
        }

        localStorage.setItem(INTERVAL_MINUTES_KEY, String(intervalMinutes));
        localStorage.setItem(ALARM_SOUND_KEY, alarmSound);
        localStorage.setItem(AI_PERSONALITY_KEY, personality);
        localStorage.setItem(FOCUS_BUMP_HOURS_KEY, String(focusBumpAfterHours));
        localStorage.setItem(DELETE_ON_COMPLETION_KEY, String(deleteOnCompletion));
    }, [alarmSound, deleteOnCompletion, focusBumpAfterHours, hasLoadedSettings, intervalMinutes, personality]);

    useEffect(() => {
        if (!isSettingsOpen) {
            return;
        }

        const onMouseDown = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }

            if (!settingsMenuRef.current?.contains(target)) {
                setIsSettingsOpen(false);
            }
        };

        document.addEventListener('mousedown', onMouseDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [isSettingsOpen]);

    const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const parsed = Number(e.target.value);
        setIntervalMinutes(normalizeIntervalMinutes(parsed));
    };

    const handleAlarmSoundChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setAlarmSound(normalizeAlarmSound(e.target.value));
    };
    const handlePersonalityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setPersonality(normalizePersonality(e.target.value));
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

    return (
        <div className="app-container">
            <div className="main-content">
                <header className="app-header">
                    <div className="header-top">
                        <h1>Todo AI</h1>
                        <div className="header-actions">
                            {!isTabMode && (
                                <button
                                    type="button"
                                    className="open-tab-btn"
                                    onClick={openFullScreenView}
                                >
                                    Open Full Screen
                                </button>
                            )}
                            <div className="settings-menu-wrap" ref={settingsMenuRef}>
                                <button
                                    type="button"
                                    className="settings-btn"
                                    onClick={() => {
                                        setIsSettingsOpen((prev) => !prev);
                                    }}
                                    aria-expanded={isSettingsOpen}
                                >
                                    Settings
                                </button>
                                {isSettingsOpen && (
                                    <div className="settings-menu-panel">
                                        <div className="settings-menu-grid">
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
                                            <div className="interval-setting">
                                                <label htmlFor="aiPersonality">AI personality</label>
                                                <select
                                                    id="aiPersonality"
                                                    value={personality}
                                                    onChange={handlePersonalityChange}
                                                >
                                                    {PERSONALITY_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="interval-setting">
                                                <label htmlFor="focusBumpHours">Bump when task in focus for (hours)</label>
                                                <input
                                                    id="focusBumpHours"
                                                    type="number"
                                                    min={MIN_FOCUS_BUMP_HOURS}
                                                    max={MAX_FOCUS_BUMP_HOURS}
                                                    step={1}
                                                    value={focusBumpAfterHours}
                                                    onChange={(e) => {
                                                        const v = Number(e.target.value);
                                                        if (Number.isFinite(v)) setFocusBumpAfterHours(Math.max(MIN_FOCUS_BUMP_HOURS, Math.min(MAX_FOCUS_BUMP_HOURS, Math.round(v))));
                                                    }}
                                                />
                                            </div>
                                            <div className="interval-setting interval-setting--checkbox">
                                                <label className="interval-setting-checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={deleteOnCompletion}
                                                        onChange={(e) => setDeleteOnCompletion(e.target.checked)}
                                                    />
                                                    <span>Delete on completion</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                <section className="todo-section">
                    {activeTimer && (
                        <div className="active-timer-bar" role="status">
                            <span className="active-timer-label">Timer</span>
                            <span className="active-timer-task">{activeTimer.taskTitle}</span>
                            <span className="active-timer-remaining">
                                {Math.max(0, Math.ceil((activeTimer.endAt - Date.now()) / 60000))} min left
                            </span>
                        </div>
                    )}
                    <TodoForm onAdd={addTodo} />
                    <TodoList
                        todos={todos}
                        onReorder={reorderTodos}
                        onToggle={(id) => toggleTodo(id, { deleteIfCompleted: deleteOnCompletion })}
                        onDelete={deleteTodo}
                        onUpdateTodo={updateTodo}
                        activeTimerTaskId={activeTimer?.taskId ?? null}
                        onStartTimer={handleStartTimer}
                    />
                </section>
            </div>

            <aside className="companion-sidebar">
                <CompanionFrame
                    todos={todos}
                    personality={personality}
                    focusBumpAfterHours={focusBumpAfterHours}
                    onAddTodo={addTodo}
                    onToggleTodo={(id) => toggleTodo(id, { deleteIfCompleted: deleteOnCompletion })}
                    onUpdateTodo={updateTodo}
                />
            </aside>
        </div>
    );
}

export default App;

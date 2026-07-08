import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTodos } from './hooks/useTodos';
import { TodoList } from './components/TodoList';
import { TodoForm } from './components/TodoForm';
import { ReminderPopup } from './components/ReminderPopup';
import { ArchiveList } from './components/ArchiveList';
import { clearReminderAlarm, scheduleReminderAlarm } from './reminders';
import type { PushBackReminders, Todo } from './types';

const INTERVAL_MINUTES_KEY = 'todo-ai-auto-open-interval-minutes-v2';
const ALARM_SOUND_KEY = 'todo-ai-alarm-sound-v2';
const PUSH_BACK_REMINDERS_KEY = 'todo-ai-push-back-reminders-v1';
const DEFAULT_INTERVAL_MINUTES = 120;
const MIN_INTERVAL_MINUTES = 1;
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

const PUSH_BACK_REMINDERS_OPTIONS: { value: PushBackReminders; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'normal', label: 'Normal' },
    { value: 'snarky', label: 'Snarky' },
];
const DEFAULT_PUSH_BACK_REMINDERS: PushBackReminders = 'snarky';
const PUSH_BACK_REMINDERS_VALUES = new Set<PushBackReminders>(
    PUSH_BACK_REMINDERS_OPTIONS.map((option) => option.value)
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

const normalizePushBackReminders = (value: unknown): PushBackReminders => {
    if (typeof value !== 'string') {
        return DEFAULT_PUSH_BACK_REMINDERS;
    }

    return PUSH_BACK_REMINDERS_VALUES.has(value as PushBackReminders)
        ? (value as PushBackReminders)
        : DEFAULT_PUSH_BACK_REMINDERS;
};

function App() {
    const isTabMode = new URLSearchParams(window.location.search).get('view') === 'tab';
    const {
        todos,
        archivedTodos,
        addTodo,
        deleteTodo,
        toggleTodo,
        updateTodo,
        restoreTodo,
        deleteArchived,
        clearArchive,
    } = useTodos();
    const [intervalMinutes, setIntervalMinutes] = useState<number>(DEFAULT_INTERVAL_MINUTES);
    const [alarmSound, setAlarmSound] = useState<AlarmSoundOption>(DEFAULT_ALARM_SOUND);
    const [pushBackReminders, setPushBackReminders] = useState<PushBackReminders>(DEFAULT_PUSH_BACK_REMINDERS);
    const [hasLoadedSettings, setHasLoadedSettings] = useState<boolean>(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
    const [now, setNow] = useState<number>(Date.now());
    const [clockNow, setClockNow] = useState<number>(Date.now());
    const settingsMenuRef = useRef<HTMLDivElement | null>(null);

    // Ticks every second so due-date captions render as live countdowns.
    useEffect(() => {
        const id = setInterval(() => setClockNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    // Fire the reminder popup for the first "do now" task whose reminder time has passed.
    const activeReminder = useMemo<Todo | null>(
        () =>
            todos.find(
                (todo) => !todo.completed && typeof todo.remindAt === 'number' && todo.remindAt <= now
            ) ?? null,
        [todos, now]
    );

    // Wake up exactly when the soonest pending reminder is due (also re-checks after one is handled).
    useEffect(() => {
        const upcoming = todos
            .filter((todo) => !todo.completed && typeof todo.remindAt === 'number' && (todo.remindAt as number) > now)
            .map((todo) => todo.remindAt as number);
        if (upcoming.length === 0) {
            return;
        }
        const soonest = Math.min(...upcoming);
        const delay = Math.max(0, soonest - Date.now()) + 50;
        const id = setTimeout(() => setNow(Date.now()), delay);
        return () => clearTimeout(id);
    }, [todos, now]);

    // Pushing back a due date that was already set counts as a delay; giving a
    // long-term goal its first due date does not.
    const setReminder = (todo: Todo, remindAt: number) => {
        const delayCount = todo.remindAt != null ? (todo.delayCount ?? 0) + 1 : (todo.delayCount ?? 0);
        updateTodo(todo.id, { remindAt, delayCount });
        scheduleReminderAlarm(todo.id, remindAt);
        setNow(Date.now());
    };

    const clearReminder = (todo: Todo) => {
        updateTodo(todo.id, { remindAt: undefined, delayCount: 0 });
        clearReminderAlarm(todo.id);
        setNow(Date.now());
    };

    const handleReminderDone = (todo: Todo) => {
        clearReminderAlarm(todo.id);
        toggleTodo(todo.id);
        setNow(Date.now());
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
            chrome.storage.local.get(
                [INTERVAL_MINUTES_KEY, ALARM_SOUND_KEY, PUSH_BACK_REMINDERS_KEY],
                (result) => {
                    const normalizedInterval = normalizeIntervalMinutes(result[INTERVAL_MINUTES_KEY]);
                    const normalizedSound = normalizeAlarmSound(result[ALARM_SOUND_KEY]);
                    const normalizedPushBack = normalizePushBackReminders(result[PUSH_BACK_REMINDERS_KEY]);
                    setIntervalMinutes(normalizedInterval);
                    setAlarmSound(normalizedSound);
                    setPushBackReminders(normalizedPushBack);
                    setHasLoadedSettings(true);
                }
            );
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
        const savedPushBack = localStorage.getItem(PUSH_BACK_REMINDERS_KEY);
        if (savedPushBack) {
            setPushBackReminders(normalizePushBackReminders(savedPushBack));
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
                [PUSH_BACK_REMINDERS_KEY]: pushBackReminders,
            });
            return;
        }

        localStorage.setItem(INTERVAL_MINUTES_KEY, String(intervalMinutes));
        localStorage.setItem(ALARM_SOUND_KEY, alarmSound);
        localStorage.setItem(PUSH_BACK_REMINDERS_KEY, pushBackReminders);
    }, [alarmSound, hasLoadedSettings, intervalMinutes, pushBackReminders]);

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

    const handlePushBackRemindersChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setPushBackReminders(normalizePushBackReminders(e.target.value));
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
                        <h1>Todo</h1>
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
                                                <label htmlFor="pushBackReminders">Push back reminders</label>
                                                <select
                                                    id="pushBackReminders"
                                                    value={pushBackReminders}
                                                    onChange={handlePushBackRemindersChange}
                                                >
                                                    {PUSH_BACK_REMINDERS_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                <section className="todo-section">
                    <TodoForm onAdd={addTodo} />
                    <TodoList
                        todos={todos}
                        now={clockNow}
                        pushBackReminders={pushBackReminders}
                        onToggle={toggleTodo}
                        onDelete={deleteTodo}
                        onUpdateTodo={updateTodo}
                        onSetReminder={setReminder}
                        onClearReminder={clearReminder}
                    />
                    <ArchiveList
                        archivedTodos={archivedTodos}
                        now={clockNow}
                        onRestore={restoreTodo}
                        onDelete={deleteArchived}
                        onClear={clearArchive}
                    />
                </section>
            </div>

            {activeReminder && (
                <ReminderPopup
                    todo={activeReminder}
                    pushBackReminders={pushBackReminders}
                    onDone={() => handleReminderDone(activeReminder)}
                    onReschedule={(remindAt) => setReminder(activeReminder, remindAt)}
                    onRelegate={() => clearReminder(activeReminder)}
                />
            )}
        </div>
    );
}

export default App;

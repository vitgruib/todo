import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTodos } from './hooks/useTodos';
import { TodoList } from './components/TodoList';
import { TodoForm } from './components/TodoForm';
import { ReminderPopup } from './components/ReminderPopup';
import { ArchiveList } from './components/ArchiveList';
import { clearReminderAlarm, nextDelayCount, scheduleReminderAlarm } from './reminders';
import type { Todo } from './types';

const ALARM_SOUND_KEY = 'todo-ai-alarm-sound-v2';
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
    ALARM_SOUND_OPTIONS.map((option) => option.value),
);

const normalizeAlarmSound = (value: unknown): AlarmSoundOption => {
    if (typeof value !== 'string') {
        return DEFAULT_ALARM_SOUND;
    }

    return ALARM_SOUND_VALUES.has(value as AlarmSoundOption)
        ? (value as AlarmSoundOption)
        : DEFAULT_ALARM_SOUND;
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
    const [alarmSound, setAlarmSound] = useState<AlarmSoundOption>(DEFAULT_ALARM_SOUND);
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
                (todo) =>
                    !todo.completed && typeof todo.remindAt === 'number' && todo.remindAt <= now,
            ) ?? null,
        [todos, now],
    );

    // Wake up exactly when the soonest pending reminder is due (also re-checks after one is handled).
    useEffect(() => {
        const upcoming = todos
            .filter(
                (todo) =>
                    !todo.completed &&
                    typeof todo.remindAt === 'number' &&
                    (todo.remindAt as number) > now,
            )
            .map((todo) => todo.remindAt as number);
        if (upcoming.length === 0) {
            return;
        }
        const soonest = Math.min(...upcoming);
        const delay = Math.max(0, soonest - Date.now()) + 50;
        const id = setTimeout(() => setNow(Date.now()), delay);
        return () => clearTimeout(id);
    }, [todos, now]);

    // Every due-date change (popup reschedule, focus-menu update, custom date, duration) flows
    // through here; nextDelayCount decides whether it counts as a push-back. See reminders.ts.
    const setReminder = (todo: Todo, remindAt: number) => {
        updateTodo(todo.id, { remindAt, delayCount: nextDelayCount(todo, remindAt) });
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
            chrome.storage.local.get([ALARM_SOUND_KEY], (result) => {
                const normalizedSound = normalizeAlarmSound(result[ALARM_SOUND_KEY]);
                setAlarmSound(normalizedSound);
                setHasLoadedSettings(true);
            });
            return;
        }

        const savedSound = localStorage.getItem(ALARM_SOUND_KEY);
        if (savedSound) {
            const normalizedSound = normalizeAlarmSound(savedSound);
            setAlarmSound(normalizedSound);
        }

        setHasLoadedSettings(true);
    }, []);

    useEffect(() => {
        if (!hasLoadedSettings) {
            return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
                [ALARM_SOUND_KEY]: alarmSound,
            });
            return;
        }

        localStorage.setItem(ALARM_SOUND_KEY, alarmSound);
    }, [alarmSound, hasLoadedSettings]);

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

    const handleAlarmSoundChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setAlarmSound(normalizeAlarmSound(e.target.value));
    };

    const openFullScreenView = () => {
        const tabViewUrl =
            typeof chrome !== 'undefined' && chrome.runtime?.getURL
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
                                                <label htmlFor="alarmSound">Alarm sound</label>
                                                <select
                                                    id="alarmSound"
                                                    value={alarmSound}
                                                    onChange={handleAlarmSoundChange}
                                                >
                                                    {ALARM_SOUND_OPTIONS.map((option) => (
                                                        <option
                                                            key={option.value}
                                                            value={option.value}
                                                        >
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
                    onDone={() => handleReminderDone(activeReminder)}
                    onReschedule={(remindAt) => setReminder(activeReminder, remindAt)}
                    onRelegate={() => clearReminder(activeReminder)}
                />
            )}
        </div>
    );
}

export default App;

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    SYNC_KEYS,
    type BackupSnapshot,
    useTodos,
} from './hooks/useTodos';
import { TodoList } from './components/TodoList';
import { TodoForm } from './components/TodoForm';
import { ReminderPopup } from './components/ReminderPopup';
import { ArchiveList } from './components/ArchiveList';
import { GuideScreen } from './components/GuideScreen';
import { Celebration } from './components/Celebration';
import {
    clearReminderAlarm,
    nextDelayCount,
    scheduleReminderAlarm,
    setRenagPeriodMinutes,
} from './reminders';
import { playCelebrationSound } from './celebration';
import {
    clearSynced,
    hasSyncedSnapshot,
    loadSyncPreference,
    setSyncPreference,
    syncGet,
    syncSet,
} from './storage';
import type { Todo } from './types';
import type { DuplicateResolution } from './backupImport';

// Shown in the header so it's obvious at a glance whether a reload actually picked up new code.
const APP_VERSION =
    (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.().version) || 'dev';

const ALARM_SOUND_KEY = 'todo-ai-alarm-sound-v2';
// Remembers the user's "don't warn me again" choice for the mark-urgent confirmation.
const SUPPRESS_URGENT_WARNING_KEY = 'todo-ai-suppress-urgent-warning-v1';
// Whether the first-run guide has been dismissed.
const GUIDE_SEEN_KEY = 'todo-ai-guide-seen-v1';
// Whether to play a sound + confetti when a task is finished (on by default).
const CELEBRATE_KEY = 'todo-ai-celebrate-v1';
// How long the Undo toast stays before the action becomes permanent.
const UNDO_TIMEOUT_MS = 6000;
// Keep the reminder popup window open this long after a finish, so the confetti can play out.
const CELEBRATION_HOLD_MS = 1500;

// A transient bottom toast. With `undo` it offers a one-click revert; without, it's just a notice.
type UndoState = { message: string; undo?: () => void } | null;
type PendingBackupImport = {
    snapshot: BackupSnapshot;
    activeDuplicates: number;
};
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

// How often a closed-but-unaddressed reminder pops back up (minutes; 0 = show once, no repeat).
const RENAG_PERIOD_KEY = 'todo-ai-renag-period-v1';
const RENAG_OPTIONS = [
    { value: 0, label: 'Don’t come back' },
    { value: 1, label: '1 minute' },
    { value: 2, label: '2 minutes' },
    { value: 5, label: '5 minutes' },
    { value: 10, label: '10 minutes' },
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 60, label: '1 hour' },
] as const;
const DEFAULT_RENAG_MINUTES = 5;
const RENAG_VALUES = new Set<number>(RENAG_OPTIONS.map((o) => o.value));

const normalizeRenag = (value: unknown): number =>
    typeof value === 'number' && RENAG_VALUES.has(value) ? value : DEFAULT_RENAG_MINUTES;

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
        reinsertTodo,
        restoreArchive,
        exportSnapshot,
        previewImportSnapshot,
        importSnapshot,
        replaceSyncedTasks,
        replaceWithSyncedTasks,
    } = useTodos();
    const [alarmSound, setAlarmSound] = useState<AlarmSoundOption>(DEFAULT_ALARM_SOUND);
    const [renagMinutes, setRenagMinutes] = useState<number>(DEFAULT_RENAG_MINUTES);
    const [hasLoadedSettings, setHasLoadedSettings] = useState<boolean>(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
    const [clockNow, setClockNow] = useState<number>(Date.now());
    // "Don't warn me again" preference for marking tasks urgent, plus the pending confirmation.
    const [suppressUrgentWarning, setSuppressUrgentWarning] = useState<boolean>(false);
    const [pendingUrgentConfirm, setPendingUrgentConfirm] = useState<(() => void) | null>(null);
    const [dontWarnUrgentAgain, setDontWarnUrgentAgain] = useState<boolean>(false);
    const [guideSeen, setGuideSeen] = useState<boolean>(true);
    const [showGuide, setShowGuide] = useState<boolean>(false);
    const [celebrateEnabled, setCelebrateEnabled] = useState<boolean>(true);
    // Per-device opt-in: mirror tasks through the browser's sync store to your other computers.
    const [cloudSync, setCloudSync] = useState<boolean>(false);
    const [syncEnableChoiceOpen, setSyncEnableChoiceOpen] = useState<boolean>(false);
    const [hasAccountTasks, setHasAccountTasks] = useState<boolean>(false);
    const [pendingBackupImport, setPendingBackupImport] = useState<PendingBackupImport | null>(
        null,
    );
    const [celebrateNonce, setCelebrateNonce] = useState<number>(0);
    const [undoState, setUndoState] = useState<UndoState>(null);
    const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Timestamp until which the reminder window should stay open so a just-fired celebration shows.
    const celebrateUntilRef = useRef<number>(0);
    const settingsMenuRef = useRef<HTMLDivElement | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    // Ticks every second so due-date captions render as live countdowns.
    useEffect(() => {
        const id = setInterval(() => setClockNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    // The first "do now" task whose deadline has passed. Keyed on the per-second clock so an
    // overdue task is detected the instant a reminder window opens (and every second after), and
    // on `todos` so completing/rescheduling/relegating re-evaluates immediately.
    const activeReminder = useMemo<Todo | null>(
        () =>
            todos.find(
                (todo) =>
                    !todo.completed &&
                    typeof todo.remindAt === 'number' &&
                    todo.remindAt <= clockNow,
            ) ?? null,
        [todos, clockNow],
    );

    // Every due-date change (popup reschedule, focus-menu update, custom date, duration) flows
    // through here; nextDelayCount decides whether it counts as a push-back. See reminders.ts.
    const setReminder = (todo: Todo, remindAt: number) => {
        const now = Date.now();
        // "Urgent" means you're not pushing it back — so the moment you do, the flag comes off.
        // Pulling the deadline *earlier* isn't a delay, so urgency survives that.
        const snoozedWhileUrgent =
            !!todo.urgent && todo.remindAt != null && remindAt > todo.remindAt;
        const delayCount = nextDelayCount(todo, remindAt, now);
        updateTodo(todo.id, {
            remindAt,
            delayCount,
            ...(delayCount > (todo.delayCount ?? 0) ? { lastDelayedAt: now } : {}),
            ...(snoozedWhileUrgent ? { urgent: false } : {}),
        });
        scheduleReminderAlarm(todo.id, remindAt);
        if (snoozedWhileUrgent) {
            triggerNotice('You snoozed an urgent task — it’s no longer marked urgent. Lock in! 🔒');
        }
    };

    const clearReminder = (todo: Todo) => {
        // Relegating drops the deadline, so "urgent / can't be delayed" no longer means anything.
        updateTodo(todo.id, { remindAt: undefined, delayCount: 0, urgent: false });
        clearReminderAlarm(todo.id);
    };

    // Gate marking a task urgent behind the warning dialog, unless the user has silenced it.
    // `onConfirm` performs the actual mark (create with urgent, or flip an existing task).
    const requestMarkUrgent = (onConfirm: () => void) => {
        if (suppressUrgentWarning) {
            onConfirm();
            return;
        }
        setDontWarnUrgentAgain(false);
        setPendingUrgentConfirm(() => onConfirm);
    };

    const confirmUrgent = () => {
        if (dontWarnUrgentAgain) {
            setSuppressUrgentWarning(true);
        }
        pendingUrgentConfirm?.();
        setPendingUrgentConfirm(null);
    };

    const cancelUrgent = () => setPendingUrgentConfirm(null);

    // Show an Undo toast for a destructive action, auto-dismissing after a few seconds.
    const triggerUndo = (message: string, undo: () => void) => {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setUndoState({ message, undo });
        undoTimerRef.current = setTimeout(() => setUndoState(null), UNDO_TIMEOUT_MS);
    };

    /** Same toast, but purely informational — no Undo button. */
    const triggerNotice = (message: string) => {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setUndoState({ message });
        undoTimerRef.current = setTimeout(() => setUndoState(null), UNDO_TIMEOUT_MS);
    };

    const runUndo = () => {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoState?.undo?.();
        setUndoState(null);
    };

    // Undoable versions of the destructive actions (delete / complete / clear archive).
    const handleDeleteTodo = (id: string) => {
        const target = todos.find((t) => t.id === id);
        deleteTodo(id);
        if (target) triggerUndo('Task deleted', () => reinsertTodo(target));
    };

    const handleCompleteTodo = (id: string) => {
        toggleTodo(id);
        triggerUndo('Task completed', () => restoreTodo(id));
        if (celebrateEnabled) {
            setCelebrateNonce((n) => n + 1);
            playCelebrationSound();
            // Hold the reminder window open briefly so the confetti is visible before it closes.
            celebrateUntilRef.current = Date.now() + CELEBRATION_HOLD_MS;
        }
    };

    const handleClearArchive = () => {
        const saved = archivedTodos;
        clearArchive();
        if (saved.length > 0) triggerUndo('Archive cleared', () => restoreArchive(saved));
    };

    const handleReminderDone = (todo: Todo) => {
        handleCompleteTodo(todo.id);
    };

    // Dismiss the first-run guide and remember it.
    const dismissGuide = () => {
        setShowGuide(false);
        setGuideSeen(true);
    };

    useLayoutEffect(() => {
        document.documentElement.classList.toggle('tab-mode', isTabMode);
        document.body.classList.toggle('tab-mode', isTabMode);

        return () => {
            document.documentElement.classList.remove('tab-mode');
            document.body.classList.remove('tab-mode');
        };
    }, [isTabMode]);

    // The reminder popup window (tab mode) exists only to work through overdue tasks. Once at
    // least one reminder has shown and none remain overdue, close the window rather than leave
    // an empty popup behind. When others remain, `activeReminder` above just advances to the next.
    const hasShownReminderRef = useRef(false);
    useEffect(() => {
        if (!isTabMode) {
            return;
        }
        if (activeReminder) {
            hasShownReminderRef.current = true;
            return;
        }
        // Don't close during the initial load flash, before todos have populated a reminder.
        if (!hasShownReminderRef.current) {
            return;
        }
        const closeWindow = () => {
            if (
                typeof chrome !== 'undefined' &&
                chrome.windows?.getCurrent &&
                chrome.windows?.remove
            ) {
                chrome.windows.getCurrent((win) => {
                    if (win?.id != null) {
                        chrome.windows.remove(win.id, () => void chrome.runtime?.lastError);
                    } else {
                        window.close();
                    }
                });
            } else {
                window.close();
            }
        };
        // If a finish just fired a celebration, wait for the confetti before closing; otherwise
        // (relegate / reschedule) close right away. A new incoming reminder cancels this via cleanup.
        const wait = Math.max(0, celebrateUntilRef.current - Date.now());
        const id = setTimeout(closeWindow, wait);
        return () => clearTimeout(id);
    }, [isTabMode, activeReminder]);

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            syncGet(
                [
                    ALARM_SOUND_KEY,
                    SUPPRESS_URGENT_WARNING_KEY,
                    RENAG_PERIOD_KEY,
                    GUIDE_SEEN_KEY,
                    CELEBRATE_KEY,
                ],
                (result) => {
                    setAlarmSound(normalizeAlarmSound(result[ALARM_SOUND_KEY]));
                    setSuppressUrgentWarning(result[SUPPRESS_URGENT_WARNING_KEY] === true);
                    setRenagMinutes(normalizeRenag(result[RENAG_PERIOD_KEY]));
                    setCelebrateEnabled(result[CELEBRATE_KEY] !== false);
                    loadSyncPreference(setCloudSync);
                    const seen = result[GUIDE_SEEN_KEY] === true;
                    setGuideSeen(seen);
                    setShowGuide(!seen);
                    setHasLoadedSettings(true);
                },
            );
            return;
        }

        const savedSound = localStorage.getItem(ALARM_SOUND_KEY);
        if (savedSound) {
            setAlarmSound(normalizeAlarmSound(savedSound));
        }
        setSuppressUrgentWarning(localStorage.getItem(SUPPRESS_URGENT_WARNING_KEY) === 'true');
        const savedRenag = localStorage.getItem(RENAG_PERIOD_KEY);
        setRenagMinutes(normalizeRenag(savedRenag == null ? undefined : Number(savedRenag)));
        setCelebrateEnabled(localStorage.getItem(CELEBRATE_KEY) !== 'false');
        const seen = localStorage.getItem(GUIDE_SEEN_KEY) === 'true';
        setGuideSeen(seen);
        setShowGuide(!seen);
        setHasLoadedSettings(true);
    }, []);

    useEffect(() => {
        if (!hasLoadedSettings) {
            return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            syncSet({
                [ALARM_SOUND_KEY]: alarmSound,
                [SUPPRESS_URGENT_WARNING_KEY]: suppressUrgentWarning,
                [RENAG_PERIOD_KEY]: renagMinutes,
                [GUIDE_SEEN_KEY]: guideSeen,
                [CELEBRATE_KEY]: celebrateEnabled,
            });
            return;
        }

        localStorage.setItem(ALARM_SOUND_KEY, alarmSound);
        localStorage.setItem(SUPPRESS_URGENT_WARNING_KEY, String(suppressUrgentWarning));
        localStorage.setItem(RENAG_PERIOD_KEY, String(renagMinutes));
        localStorage.setItem(GUIDE_SEEN_KEY, String(guideSeen));
        localStorage.setItem(CELEBRATE_KEY, String(celebrateEnabled));
    }, [
        alarmSound,
        suppressUrgentWarning,
        renagMinutes,
        guideSeen,
        celebrateEnabled,
        hasLoadedSettings,
    ]);

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

    const handleRenagChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const minutes = normalizeRenag(Number(e.target.value));
        setRenagMinutes(minutes);
        // Re-apply to any active re-nag loop immediately (not just newly-scheduled reminders).
        setRenagPeriodMinutes(minutes);
    };

    // Download tasks AND settings as one JSON file (no permission needed — a plain object-URL link).
    // Every date is stored as an epoch-ms number, so it survives the round-trip unchanged.
    const handleExportTasks = () => {
        const snap = exportSnapshot();
        const payload = {
            app: 'Toto Simple',
            version: 1,
            exportedAt: Date.now(),
            tasks: snap.tasks,
            archive: snap.archive,
            tombstones: snap.tombstones,
            // Preferences travel too — but not the per-device sync toggle (that's a per-machine call).
            settings: {
                alarmSound,
                renagMinutes,
                celebrateEnabled,
                suppressUrgentWarning,
                guideSeen,
            },
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `toto-simple-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const finishBackupImport = (
        snapshot: BackupSnapshot,
        resolution: DuplicateResolution,
    ) => {
        const count = importSnapshot(snapshot, resolution);
        const taskPart = `${count} task${count === 1 ? '' : 's'} added`;
        triggerNotice(`Imported — ${taskPart}.`);
        setPendingBackupImport(null);
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // let the same file be picked again later
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            let raw: unknown;
            try {
                raw = JSON.parse(String(reader.result ?? ''));
            } catch {
                triggerNotice('That file isn’t valid JSON.');
                return;
            }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                triggerNotice('That doesn’t look like a Toto backup.');
                return;
            }
            const obj = raw as Record<string, unknown>;
            const snapshot: BackupSnapshot = {
                tasks: obj.tasks,
            };
            if (!Array.isArray(obj.tasks)) {
                triggerNotice('No active tasks found in that file.');
                return;
            }
            const preview = previewImportSnapshot(snapshot);
            if (preview.activeDuplicates) {
                setPendingBackupImport({ snapshot, ...preview });
                return;
            }
            finishBackupImport(snapshot, 'keep-existing');
        };
        reader.onerror = () => triggerNotice('Couldn’t read that file.');
        reader.readAsText(file);
    };

    // Turning sync on always asks which task set should become authoritative. Turning it off clears
    // the account-wide copy, so nothing remains in browser sync storage.
    const handleCloudSyncChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const enabled = e.target.checked;
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        if (!enabled) {
            setCloudSync(false);
            setSyncPreference(false, () => clearSynced(SYNC_KEYS));
            return;
        }
        hasSyncedSnapshot((exists) => {
            setHasAccountTasks(exists);
            setSyncEnableChoiceOpen(true);
        });
    };

    const enableSync = (source: 'this-device' | 'account') => {
        setSyncPreference(true, () => {
            setCloudSync(true);
            if (source === 'this-device') {
                replaceSyncedTasks();
            } else {
                replaceWithSyncedTasks();
            }
            setSyncEnableChoiceOpen(false);
        });
    };

    return (
        <div className="app-container">
            <div className="main-content">
                <header className="app-header">
                    <div className="header-top">
                        <div className="app-title">
                            <h1>Toto Simple</h1>
                            <span className="app-version">v{APP_VERSION}</span>
                        </div>
                        <div className="header-actions">
                            <button
                                type="button"
                                className="help-btn"
                                onClick={() => setShowGuide(true)}
                                aria-label="How Toto Simple works"
                                title="How Toto Simple works"
                            >
                                ?
                            </button>
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
                                            <div className="settings-field">
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
                                            <div className="settings-field">
                                                <label htmlFor="renagPeriod">Snooze duration</label>
                                                <select
                                                    id="renagPeriod"
                                                    value={renagMinutes}
                                                    onChange={handleRenagChange}
                                                >
                                                    {RENAG_OPTIONS.map((option) => (
                                                        <option
                                                            key={option.value}
                                                            value={option.value}
                                                        >
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="settings-field-hint">
                                                    When you close a reminder without doing the
                                                    task, this is how long it waits before popping
                                                    back up.
                                                </p>
                                            </div>
                                            <label className="settings-check">
                                                <input
                                                    type="checkbox"
                                                    checked={celebrateEnabled}
                                                    onChange={(e) =>
                                                        setCelebrateEnabled(e.target.checked)
                                                    }
                                                />
                                                <span>Celebrate finished tasks 🎉</span>
                                            </label>
                                            <section
                                                className="settings-data-section"
                                                aria-labelledby="settings-data-heading"
                                            >
                                                <h2
                                                    id="settings-data-heading"
                                                    className="settings-data-heading"
                                                >
                                                    Data &amp; devices
                                                </h2>
                                                <div className="settings-data-card">
                                                    <div className="settings-data-card-copy">
                                                        <div className="settings-data-card-title-row">
                                                            <span className="settings-data-card-title">
                                                                Sync across devices
                                                            </span>
                                                            <span
                                                                className={`settings-sync-status ${
                                                                    cloudSync
                                                                        ? 'settings-sync-status--on'
                                                                        : ''
                                                                }`}
                                                            >
                                                                {cloudSync ? 'On' : 'Off'}
                                                            </span>
                                                        </div>
                                                        <p className="settings-data-card-description">
                                                            Keep your tasks available on your other
                                                            signed-in computers.
                                                        </p>
                                                    </div>
                                                    <label className="settings-toggle">
                                                        <input
                                                            type="checkbox"
                                                            checked={cloudSync}
                                                            onChange={handleCloudSyncChange}
                                                            aria-label="Sync tasks across devices"
                                                        />
                                                        <span aria-hidden="true" />
                                                    </label>
                                                    <p className="settings-data-card-note">
                                                        {cloudSync ? (
                                                            <>
                                                                Sync is on. Use Chrome on each
                                                                computer, signed in to the same Google
                                                                account with Chrome Sync enabled. Edge
                                                                and other browsers use separate sync
                                                                accounts and do not share tasks with
                                                                Chrome. Changes can take up to 10
                                                                seconds to appear.
                                                            </>
                                                        ) : (
                                                            <>
                                                                Uses your browser account. Changes can
                                                                take up to 10 seconds to appear
                                                                elsewhere.
                                                            </>
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="settings-data-card">
                                                    <div className="settings-data-card-copy">
                                                        <span className="settings-data-card-title">
                                                            Backup your tasks
                                                        </span>
                                                        <p className="settings-data-card-description">
                                                            Save a portable copy of your tasks,
                                                            archive, and settings.
                                                        </p>
                                                    </div>
                                                    <div className="settings-backup-actions">
                                                        <button
                                                            type="button"
                                                            className="settings-action-btn settings-action-btn--primary"
                                                            onClick={handleExportTasks}
                                                        >
                                                            Export backup
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="settings-action-btn"
                                                            onClick={() =>
                                                                importInputRef.current?.click()
                                                            }
                                                        >
                                                            Import backup
                                                        </button>
                                                    </div>
                                                    <input
                                                        ref={importInputRef}
                                                        type="file"
                                                        accept="application/json,.json"
                                                        onChange={handleImportFile}
                                                        hidden
                                                    />
                                                    <p className="settings-data-card-note">
                                                        Importing adds tasks without deleting the
                                                        ones already here.
                                                    </p>
                                                </div>
                                            </section>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                <section className="todo-section">
                    <TodoForm onAdd={addTodo} onRequestUrgent={requestMarkUrgent} />
                    <TodoList
                        todos={todos}
                        now={clockNow}
                        onToggle={handleCompleteTodo}
                        onDelete={handleDeleteTodo}
                        onUpdateTodo={updateTodo}
                        onSetReminder={setReminder}
                        onClearReminder={clearReminder}
                        onRequestUrgent={requestMarkUrgent}
                    />
                    <ArchiveList
                        archivedTodos={archivedTodos}
                        now={clockNow}
                        onRestore={restoreTodo}
                        onDelete={deleteArchived}
                        onClear={handleClearArchive}
                    />
                </section>
            </div>

            {activeReminder && (
                <ReminderPopup
                    todo={activeReminder}
                    syncing={cloudSync}
                    onDone={() => handleReminderDone(activeReminder)}
                    onReschedule={(remindAt) => setReminder(activeReminder, remindAt)}
                    onRelegate={() => clearReminder(activeReminder)}
                />
            )}

            {pendingUrgentConfirm && (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Mark task urgent"
                >
                    <div className="modal-card">
                        <div className="modal-eyebrow">🔴 Heads up</div>
                        <h2 className="modal-title">Mark this task urgent?</h2>
                        <p className="modal-body">
                            Urgent tasks are highlighted and jump to the top of the list. If you
                            push the deadline back, <strong>the urgent flag comes off</strong> —
                            because something you keep delaying isn’t really urgent.
                        </p>
                        <label className="modal-checkbox">
                            <input
                                type="checkbox"
                                checked={dontWarnUrgentAgain}
                                onChange={(e) => setDontWarnUrgentAgain(e.target.checked)}
                            />
                            Don’t show this warning again
                        </label>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="modal-btn modal-btn--ghost"
                                onClick={cancelUrgent}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="modal-btn modal-btn--danger"
                                onClick={confirmUrgent}
                            >
                                Mark urgent
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingBackupImport && (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Resolve backup duplicates"
                >
                    <div className="modal-card modal-card--backup-import">
                        <div className="modal-eyebrow">Backup has duplicates</div>
                        <h2 className="modal-title">Which version should Toto keep?</h2>
                        <p className="modal-body">
                            {pendingBackupImport.activeDuplicates} imported active task
                            {pendingBackupImport.activeDuplicates === 1 ? '' : 's'} already exist
                            in this task list.
                        </p>
                        <div className="backup-import-actions">
                            <button
                                type="button"
                                className="backup-import-option"
                                onClick={() =>
                                    finishBackupImport(
                                        pendingBackupImport.snapshot,
                                        'keep-existing',
                                    )
                                }
                                >
                                    <strong>Keep existing</strong>
                                <span>Leave the existing active task unchanged.</span>
                            </button>
                            <button
                                type="button"
                                className="backup-import-option"
                                onClick={() =>
                                    finishBackupImport(
                                        pendingBackupImport.snapshot,
                                        'keep-imported',
                                    )
                                }
                            >
                                <strong>Keep imported</strong>
                                <span>Replace the existing active task with the backup version.</span>
                            </button>
                            <button
                                type="button"
                                className="backup-import-option"
                                onClick={() =>
                                    finishBackupImport(pendingBackupImport.snapshot, 'keep-both')
                                }
                            >
                                <strong>Keep both</strong>
                                <span>Add the backup task alongside the existing active task.</span>
                            </button>
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="modal-btn modal-btn--ghost"
                                onClick={() => setPendingBackupImport(null)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {syncEnableChoiceOpen && (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Choose a sync source"
                >
                    <div className="modal-card modal-card--backup-import">
                        <div className="modal-eyebrow">Sync across devices</div>
                        <h2 className="modal-title">Which tasks should sync?</h2>
                        <p className="modal-body">
                            Choose one source before turning on sync. This prevents task lists from
                            merging unexpectedly.
                        </p>
                        <div className="backup-import-actions">
                            <button
                                type="button"
                                className="backup-import-option"
                                onClick={() => enableSync('this-device')}
                            >
                                <strong>Use this computer as the base</strong>
                                <span>
                                    Replace the tasks saved to this Google account with this
                                    computer’s tasks.
                                </span>
                            </button>
                            {hasAccountTasks && (
                                <button
                                    type="button"
                                    className="backup-import-option"
                                    onClick={() => enableSync('account')}
                                >
                                    <strong>Use account tasks</strong>
                                    <span>
                                        Replace this computer’s tasks with the tasks already saved
                                        to this Google account.
                                    </span>
                                </button>
                            )}
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="modal-btn modal-btn--ghost"
                                onClick={() => setSyncEnableChoiceOpen(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {undoState && (
                <div className="undo-toast" role="status">
                    <span className="undo-toast-msg">{undoState.message}</span>
                    {undoState.undo && (
                        <button type="button" className="undo-toast-btn" onClick={runUndo}>
                            Undo
                        </button>
                    )}
                </div>
            )}

            {showGuide && <GuideScreen version={APP_VERSION} onClose={dismissGuide} />}

            <Celebration trigger={celebrateNonce} />
        </div>
    );
}

export default App;

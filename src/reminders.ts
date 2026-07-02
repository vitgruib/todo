// Helpers for scheduling "do now" reminder alarms in the extension service worker.
// In a plain browser (dev) these are no-ops — the in-app timer handles reminders instead.

const SCHEDULE_REMINDER_MESSAGE_TYPE = 'todo-ai-schedule-reminder';
const CLEAR_REMINDER_MESSAGE_TYPE = 'todo-ai-clear-reminder';

type RuntimeLike = {
    sendMessage: (message: unknown, responseCallback?: (response?: unknown) => void) => void;
};

const getRuntime = (): RuntimeLike | null => {
    const runtime = (globalThis as { chrome?: { runtime?: Partial<RuntimeLike> } }).chrome?.runtime;
    return runtime && typeof runtime.sendMessage === 'function' ? (runtime as RuntimeLike) : null;
};

/** Ask the background service worker to open the tab when `remindAt` arrives (so the popup can show even if the tab is closed). */
export const scheduleReminderAlarm = (taskId: string, remindAt: number) => {
    const runtime = getRuntime();
    if (!runtime) return;
    runtime.sendMessage({ type: SCHEDULE_REMINDER_MESSAGE_TYPE, taskId, remindAt }, () => {});
};

/** Cancel a previously scheduled reminder alarm. */
export const clearReminderAlarm = (taskId: string) => {
    const runtime = getRuntime();
    if (!runtime) return;
    runtime.sendMessage({ type: CLEAR_REMINDER_MESSAGE_TYPE, taskId }, () => {});
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How far out a short-run task can be (re)scheduled. `ms` is added to "now". */
export const DUE_PRESETS = [
    { value: '1h', label: '1 hour', ms: 1 * HOUR_MS },
    { value: '3h', label: '3 hours', ms: 3 * HOUR_MS },
    { value: '6h', label: '6 hours', ms: 6 * HOUR_MS },
    { value: '1d', label: '1 day', ms: 1 * DAY_MS },
    { value: '3d', label: '3 days', ms: 3 * DAY_MS },
    { value: '1w', label: '1 week', ms: 7 * DAY_MS },
] as const;

/** Default due date for a brand-new short-run task (1 day out). */
export const DEFAULT_DUE_MS = 1 * DAY_MS;

/** Short relative "Due …" caption for a short-run task. */
export const formatDueCaption = (remindAt: number): string => {
    const diff = remindAt - Date.now();
    if (diff <= 0) return 'Overdue';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return `Due in ${mins}m`;
    const hours = Math.round(diff / HOUR_MS);
    if (hours < 48) return `Due in ${hours}h`;
    const days = Math.round(diff / DAY_MS);
    return `Due in ${days}d`;
};

/** Format an epoch-ms reminder for display, e.g. "3:05 PM" (today) or "Tue 3:05 PM". */
export const formatReminderTime = (remindAt: number): string => {
    const d = new Date(remindAt);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const today = new Date();
    const sameDay =
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
    if (sameDay) return time;
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
};

/** Convert an epoch-ms value into a `datetime-local` input value in local time. */
export const toDateTimeLocalValue = (ms: number): string => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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

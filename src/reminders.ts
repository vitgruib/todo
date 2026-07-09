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

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How far out a short-run task can be (re)scheduled. `ms` is added to "now". */
export const DUE_PRESETS = [
    { value: '30m', label: '30 minutes', ms: 30 * MINUTE_MS },
    { value: '1h', label: '1 hour', ms: 1 * HOUR_MS },
    { value: '2h', label: '2 hours', ms: 2 * HOUR_MS },
    { value: '4h', label: '4 hours', ms: 4 * HOUR_MS },
    { value: '6h', label: '6 hours', ms: 6 * HOUR_MS },
    { value: '1d', label: '1 day', ms: 1 * DAY_MS },
    { value: '2d', label: '2 days', ms: 2 * DAY_MS },
    { value: '3d', label: '3 days', ms: 3 * DAY_MS },
    { value: '1w', label: '1 week', ms: 7 * DAY_MS },
] as const;

/** Default due date for a brand-new short-run task (1 day out). */
export const DEFAULT_DUE_MS = 1 * DAY_MS;

/** Units offered when a user types how much time until the deadline. */
export const DURATION_UNITS = [
    { value: 'minutes', label: 'minutes', ms: MINUTE_MS },
    { value: 'hours', label: 'hours', ms: HOUR_MS },
    { value: 'days', label: 'days', ms: DAY_MS },
    { value: 'weeks', label: 'weeks', ms: 7 * DAY_MS },
] as const;

export type DurationUnit = (typeof DURATION_UNITS)[number]['value'];

/**
 * Convert a "how much time until due" input into a due timestamp relative to now.
 * Returns undefined for a missing/invalid/non-positive amount.
 */
export const durationToRemindAt = (
    amount: string,
    unit: DurationUnit,
    now: number = Date.now()
): number | undefined => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    const found = DURATION_UNITS.find((u) => u.value === unit);
    return found ? now + value * found.ms : undefined;
};

/**
 * Live countdown caption for a short-run task's due date.
 * Granularity: minutes+seconds under 1 hour, hours+minutes under 1 day, days+hours otherwise.
 * Pass `now` explicitly (e.g. from a ticking clock state) so the caption updates every render.
 */
export const formatDueCaption = (remindAt: number, now: number = Date.now()): string => {
    const diff = remindAt - now;
    if (diff <= 0) return 'Overdue';
    if (diff < HOUR_MS) {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        return `Due in ${mins}m ${secs}s`;
    }
    if (diff < DAY_MS) {
        const hours = Math.floor(diff / HOUR_MS);
        const mins = Math.floor((diff % HOUR_MS) / 60000);
        return `Due in ${hours}h ${mins}m`;
    }
    const days = Math.floor(diff / DAY_MS);
    const hours = Math.floor((diff % DAY_MS) / HOUR_MS);
    return `Due in ${days}d ${hours}h`;
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

/** Format a completion timestamp for the archive, e.g. "Jul 8, 3:05 PM" (or "Yesterday 3:05 PM" / "Today 3:05 PM"). */
export const formatCompletedAt = (completedAt: number, now: number = Date.now()): string => {
    const d = new Date(completedAt);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const startOfDay = (ms: number) => {
        const x = new Date(ms);
        x.setHours(0, 0, 0, 0);
        return x.getTime();
    };
    const dayDiff = Math.round((startOfDay(now) - startOfDay(completedAt)) / DAY_MS);
    if (dayDiff === 0) return `Today ${time}`;
    if (dayDiff === 1) return `Yesterday ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

/** Convert an epoch-ms value into a `datetime-local` input value in local time. */
export const toDateTimeLocalValue = (ms: number): string => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

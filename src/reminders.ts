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

/** Snarky remarks shown once a task has been delayed more than once (first delay gets no judgment). */
const SNARKY_DELAY_LINES = [
    "Sure, push it back again. It's not like it's going anywhere.",
    "Third time's the charm, right?",
    "At this rate it'll graduate to a long-term goal on its own.",
    "Bold strategy, ignoring it a little longer.",
    "The deadline fairy is losing patience with you.",
    "Future you says thanks for absolutely nothing.",
    "Maybe it just wants to be a long-term goal. Let it.",
];

/** Snarky line for a task's Nth delay, or null if it hasn't earned one yet (N < 2). */
export const getSnarkyDelayLine = (delayCount: number): string | null => {
    if (delayCount < 2) return null;
    return SNARKY_DELAY_LINES[(delayCount - 2) % SNARKY_DELAY_LINES.length];
};

/** Convert an epoch-ms value into a `datetime-local` input value in local time. */
export const toDateTimeLocalValue = (ms: number): string => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

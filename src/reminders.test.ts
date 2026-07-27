import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DELAY_GRACE_MS,
    DELAY_DEBOUNCE_MS,
    durationToRemindAt,
    extendReminder,
    formatCompletedAt,
    formatDueCaption,
    formatReminderTime,
    isPushBack,
    nextDelayCount,
    toDateTimeLocalValue,
} from './reminders';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('durationToRemindAt', () => {
    it('adds the amount in the given unit to now', () => {
        expect(durationToRemindAt('90', 'minutes', 0)).toBe(90 * MINUTE);
        expect(durationToRemindAt('2', 'hours', 0)).toBe(2 * HOUR);
        expect(durationToRemindAt('3', 'days', 0)).toBe(3 * DAY);
        expect(durationToRemindAt('1', 'weeks', 0)).toBe(7 * DAY);
    });

    it('is relative to the provided now', () => {
        expect(durationToRemindAt('1', 'hours', 1_000)).toBe(1_000 + HOUR);
    });

    it('rejects missing, non-numeric, zero, and negative amounts', () => {
        expect(durationToRemindAt('', 'hours', 0)).toBeUndefined();
        expect(durationToRemindAt('abc', 'hours', 0)).toBeUndefined();
        expect(durationToRemindAt('0', 'hours', 0)).toBeUndefined();
        expect(durationToRemindAt('-5', 'hours', 0)).toBeUndefined();
    });
});

describe('extendReminder', () => {
    it('adds a preset duration to the existing deadline', () => {
        expect(extendReminder(10 * HOUR, HOUR, 1 * HOUR)).toBe(11 * HOUR);
    });

    it('uses now only when a task has no existing deadline', () => {
        expect(extendReminder(undefined, HOUR, 10 * HOUR)).toBe(11 * HOUR);
    });
});

describe('formatDueCaption', () => {
    it('reports overdue at or past the deadline', () => {
        expect(formatDueCaption(1_000, 1_000)).toBe('Overdue');
        expect(formatDueCaption(1_000, 2_000)).toBe('Overdue');
    });

    it('shows minutes + seconds under an hour', () => {
        expect(formatDueCaption(5 * MINUTE + 30 * 1000, 0)).toBe('Due in 5m 30s');
    });

    it('shows hours + minutes under a day', () => {
        expect(formatDueCaption(2 * HOUR + 15 * MINUTE, 0)).toBe('Due in 2h 15m');
    });

    it('shows days + hours beyond a day', () => {
        expect(formatDueCaption(3 * DAY + 4 * HOUR, 0)).toBe('Due in 3d 4h');
    });
});

describe('isPushBack', () => {
    // Well clear of the grace window so createdAt=0 never falls inside it.
    const NOW = DELAY_GRACE_MS + DAY;

    it('is false when the task had no prior due date (first due date)', () => {
        expect(isPushBack(undefined, 5_000, 0, NOW)).toBe(false);
    });

    it('is true when the deadline moves later, by any amount', () => {
        expect(isPushBack(1_000, 2_000, 0, NOW)).toBe(true);
        expect(isPushBack(1_000, 1_001, 0, NOW)).toBe(true); // one ms later still counts
    });

    it('is false when the deadline moves earlier or stays the same', () => {
        expect(isPushBack(2_000, 1_000, 0, NOW)).toBe(false);
        expect(isPushBack(2_000, 2_000, 0, NOW)).toBe(false);
    });

    it('is false within the post-creation grace window, true just past it', () => {
        const createdAt = 10 * DAY;
        expect(isPushBack(1_000, 2_000, createdAt, createdAt + DELAY_GRACE_MS - 1)).toBe(false);
        expect(isPushBack(1_000, 2_000, createdAt, createdAt + DELAY_GRACE_MS + 1)).toBe(true);
    });
});

describe('nextDelayCount', () => {
    const NOW = DELAY_GRACE_MS + DAY;

    it('increments on a push-back', () => {
        expect(nextDelayCount({ remindAt: 1_000, createdAt: 0, delayCount: 2 }, 2_000, NOW)).toBe(
            3,
        );
    });

    it('treats a missing delayCount as zero', () => {
        expect(nextDelayCount({ remindAt: 1_000, createdAt: 0 }, 2_000, NOW)).toBe(1);
    });

    it('leaves the count unchanged when it is not a push-back', () => {
        expect(nextDelayCount({ remindAt: 2_000, createdAt: 0, delayCount: 2 }, 1_000, NOW)).toBe(
            2,
        );
        expect(nextDelayCount({ createdAt: 0, delayCount: 2 }, 2_000, NOW)).toBe(2); // first due date
    });

    it('counts multiple push-backs within five seconds as one delay', () => {
        expect(
            nextDelayCount(
                { remindAt: 1_000, createdAt: 0, delayCount: 2, lastDelayedAt: NOW - 1 },
                2_000,
                NOW,
            ),
        ).toBe(2);
        expect(
            nextDelayCount(
                {
                    remindAt: 1_000,
                    createdAt: 0,
                    delayCount: 2,
                    lastDelayedAt: NOW - DELAY_DEBOUNCE_MS,
                },
                2_000,
                NOW,
            ),
        ).toBe(3);
    });
});

describe('toDateTimeLocalValue', () => {
    it('formats a local date as YYYY-MM-DDTHH:mm with zero padding', () => {
        const local = new Date(2026, 6, 8, 3, 5); // Jul 8 2026, 03:05 local time
        expect(toDateTimeLocalValue(local.getTime())).toBe('2026-07-08T03:05');
    });
});

describe('formatReminderTime', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const timePart = (ms: number) =>
        new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    it('shows only the time for a reminder later today', () => {
        const today = new Date(2026, 6, 8, 9, 0);
        vi.useFakeTimers();
        vi.setSystemTime(today);
        const later = new Date(2026, 6, 8, 15, 5).getTime();
        expect(formatReminderTime(later)).toBe(timePart(later));
    });

    it('prefixes a weekday for a reminder on another day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 8, 9, 0));
        const otherDay = new Date(2026, 6, 10, 15, 5).getTime();
        const result = formatReminderTime(otherDay);
        expect(result).toContain(timePart(otherDay));
        expect(result).not.toBe(timePart(otherDay)); // has a weekday prefix too
    });
});

describe('formatCompletedAt', () => {
    const timePart = (ms: number) =>
        new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    it('labels same-day completions as Today', () => {
        const now = new Date(2026, 6, 8, 18, 0).getTime();
        const done = new Date(2026, 6, 8, 9, 30).getTime();
        expect(formatCompletedAt(done, now)).toBe(`Today ${timePart(done)}`);
    });

    it('labels previous-day completions as Yesterday', () => {
        const now = new Date(2026, 6, 8, 1, 0).getTime();
        const done = new Date(2026, 6, 7, 23, 0).getTime();
        expect(formatCompletedAt(done, now)).toBe(`Yesterday ${timePart(done)}`);
    });

    it('uses a month/day date for older completions', () => {
        const now = new Date(2026, 6, 8, 12, 0).getTime();
        const done = new Date(2026, 6, 3, 15, 5).getTime();
        const result = formatCompletedAt(done, now);
        expect(result).not.toContain('Today');
        expect(result).not.toContain('Yesterday');
        expect(result).toContain(timePart(done));
    });
});

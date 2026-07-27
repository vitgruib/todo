import React from 'react';
import { createPortal } from 'react-dom';
import type { Todo } from '../types';
import { SnoozeChips } from './SnoozeChips';

interface ReminderPopupProps {
    todo: Todo;
    /** Sync is on, so this reminder may be showing on the user's other computers too. */
    syncing?: boolean;
    onDone: () => void;
    onReschedule: (remindAt: number) => void;
    onRelegate: () => void;
}

export const ReminderPopup: React.FC<ReminderPopupProps> = ({
    todo,
    syncing = false,
    onDone,
    onReschedule,
    onRelegate,
}) => {
    const showDelayMarker = !todo.urgent && !!todo.delayCount;

    return createPortal(
        <div className="reminder-overlay" role="dialog" aria-modal="true" aria-label="Task due">
            <div className="reminder-popup">
                <div className="reminder-popup-eyebrow">Time's up — do it now</div>
                <h2 className="reminder-popup-title">{todo.title}</h2>
                <p className="reminder-popup-sub">
                    This deadline has passed. Knock it out, push it back, or move it to your
                    long-term goals.
                </p>

                {todo.urgent && (
                    <p className="reminder-popup-urgent">
                        🔴 Urgent — snoozing this will drop the urgent flag.
                    </p>
                )}

                {showDelayMarker && (
                    <p className="reminder-popup-delay">⏳ Delayed {todo.delayCount}× already</p>
                )}

                <button
                    type="button"
                    className="reminder-btn reminder-btn--primary"
                    onClick={onDone}
                >
                    I did it ✓
                </button>

                <div className="reminder-section-label">Snooze until…</div>
                <SnoozeChips
                    includeCustom
                    customSeed={todo.remindAt}
                    remindAt={todo.remindAt}
                    onPick={(ms) => onReschedule(ms)}
                />
                <p className="reminder-close-note">
                    Just close this window to snooze — it’ll pop back up on the schedule in Settings
                    until you deal with it.
                </p>

                {syncing && (
                    <p className="reminder-sync-note">
                        ☁️ This is also showing on your other computers. Act on one and give it
                        about 10 seconds — the others will catch up on their own.
                    </p>
                )}

                <button
                    type="button"
                    className="reminder-btn reminder-btn--ghost"
                    onClick={onRelegate}
                >
                    Relegate to long-term goal
                </button>
            </div>
        </div>,
        document.body,
    );
};

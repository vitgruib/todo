import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Todo } from '../types';
import { toDateTimeLocalValue } from '../reminders';

interface ReminderPopupProps {
    todo: Todo;
    onDone: () => void;
    onSnooze: (minutes: number) => void;
    onSetTime: (remindAt: number) => void;
    onDismiss: () => void;
}

const SNOOZE_OPTIONS = [
    { label: '10 min', minutes: 10 },
    { label: '30 min', minutes: 30 },
    { label: '1 hour', minutes: 60 },
] as const;

export const ReminderPopup: React.FC<ReminderPopupProps> = ({
    todo,
    onDone,
    onSnooze,
    onSetTime,
    onDismiss,
}) => {
    const [customValue, setCustomValue] = useState<string>(() =>
        toDateTimeLocalValue(Date.now() + 15 * 60_000)
    );

    const handleSetCustom = () => {
        const ms = new Date(customValue).getTime();
        if (Number.isNaN(ms)) {
            return;
        }
        onSetTime(ms);
    };

    return createPortal(
        <div className="reminder-overlay" role="dialog" aria-modal="true" aria-label="Task reminder">
            <div className="reminder-popup">
                <div className="reminder-popup-eyebrow">Time's up — do it now</div>
                <h2 className="reminder-popup-title">{todo.title}</h2>
                <p className="reminder-popup-sub">
                    This deadline has passed. Knock it out now, or set a new deadline.
                </p>

                <button type="button" className="reminder-btn reminder-btn--primary" onClick={onDone}>
                    I did it ✓
                </button>

                <div className="reminder-section-label">Set a new deadline</div>
                <div className="reminder-snooze-row">
                    {SNOOZE_OPTIONS.map((option) => (
                        <button
                            key={option.minutes}
                            type="button"
                            className="reminder-btn reminder-btn--snooze"
                            onClick={() => onSnooze(option.minutes)}
                        >
                            +{option.label}
                        </button>
                    ))}
                </div>

                <div className="reminder-custom-row">
                    <input
                        type="datetime-local"
                        className="reminder-custom-input"
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                    />
                    <button type="button" className="reminder-btn reminder-btn--set" onClick={handleSetCustom}>
                        Set
                    </button>
                </div>

                <button type="button" className="reminder-btn reminder-btn--ghost" onClick={onDismiss}>
                    Dismiss (no reminder)
                </button>
            </div>
        </div>,
        document.body
    );
};

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Todo } from '../types';
import { DUE_PRESETS, toDateTimeLocalValue } from '../reminders';

interface ReminderPopupProps {
    todo: Todo;
    onDone: () => void;
    onReschedule: (remindAt: number) => void;
    onRelegate: () => void;
}

const CUSTOM = 'custom';

export const ReminderPopup: React.FC<ReminderPopupProps> = ({
    todo,
    onDone,
    onReschedule,
    onRelegate,
}) => {
    const [selection, setSelection] = useState<string>(DUE_PRESETS[3].value); // default: 1 day
    const [customValue, setCustomValue] = useState<string>(() =>
        toDateTimeLocalValue(Date.now() + 60 * 60_000)
    );

    const isCustom = selection === CUSTOM;

    const handleSet = () => {
        if (isCustom) {
            const ms = new Date(customValue).getTime();
            if (Number.isNaN(ms)) {
                return;
            }
            onReschedule(ms);
            return;
        }
        const preset = DUE_PRESETS.find((option) => option.value === selection);
        if (preset) {
            onReschedule(Date.now() + preset.ms);
        }
    };

    return createPortal(
        <div className="reminder-overlay" role="dialog" aria-modal="true" aria-label="Task due">
            <div className="reminder-popup">
                <div className="reminder-popup-eyebrow">Time's up — do it now</div>
                <h2 className="reminder-popup-title">{todo.title}</h2>
                <p className="reminder-popup-sub">
                    This deadline has passed. Knock it out, push it back, or move it to your long-term goals.
                </p>

                <button type="button" className="reminder-btn reminder-btn--primary" onClick={onDone}>
                    I did it ✓
                </button>

                <div className="reminder-section-label">Set a new deadline</div>
                <div className="reminder-custom-row">
                    <select
                        className="reminder-custom-input"
                        value={selection}
                        onChange={(e) => setSelection(e.target.value)}
                    >
                        {DUE_PRESETS.map((option) => (
                            <option key={option.value} value={option.value}>
                                In {option.label}
                            </option>
                        ))}
                        <option value={CUSTOM}>Custom…</option>
                    </select>
                    <button type="button" className="reminder-btn reminder-btn--set" onClick={handleSet}>
                        Set
                    </button>
                </div>
                {isCustom && (
                    <input
                        type="datetime-local"
                        className="reminder-custom-input reminder-custom-input--full"
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                    />
                )}

                <button type="button" className="reminder-btn reminder-btn--ghost" onClick={onRelegate}>
                    Relegate to long-term goal
                </button>
            </div>
        </div>,
        document.body
    );
};

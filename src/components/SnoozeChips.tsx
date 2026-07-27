import React, { useState } from 'react';
import { extendReminder, SNOOZE_PRESETS, toDateTimeLocalValue } from '../reminders';

interface SnoozeChipsProps {
    /** Called with the chosen absolute due time (epoch ms). */
    onPick: (remindAt: number) => void;
    /** Show the 📅 pick-exact-date option (kept for users who want a precise deadline). */
    includeCustom?: boolean;
    /** Seed value for the custom date picker (defaults to 1 hour from now). */
    customSeed?: number;
    /** Current deadline. Preset chips extend this time instead of resetting from now. */
    remindAt?: number;
    className?: string;
}

// One-tap reschedule: each chip applies immediately, no confirm button. A 📅 option stays for
// picking an exact date/time when the presets aren't enough.
export const SnoozeChips: React.FC<SnoozeChipsProps> = ({
    onPick,
    includeCustom = false,
    customSeed,
    remindAt,
    className,
}) => {
    const [showCustom, setShowCustom] = useState(false);
    const [customValue, setCustomValue] = useState(() =>
        toDateTimeLocalValue(customSeed ?? Date.now() + 60 * 60_000),
    );

    const customMs = new Date(customValue).getTime();
    const customValid = !Number.isNaN(customMs);

    return (
        <div className={`snooze-chips-wrap ${className ?? ''}`}>
            <div className="snooze-chips">
                {SNOOZE_PRESETS.map((preset) => (
                    <button
                        key={preset.label}
                        type="button"
                        className="snooze-chip"
                        onClick={() => onPick(extendReminder(remindAt, preset.ms))}
                    >
                        {preset.label}
                    </button>
                ))}
                {includeCustom && (
                    <button
                        type="button"
                        className={`snooze-chip snooze-chip--custom ${showCustom ? 'snooze-chip--active' : ''}`}
                        onClick={() => setShowCustom((s) => !s)}
                        aria-expanded={showCustom}
                        aria-label="Pick an exact date and time"
                        title="Pick an exact date & time"
                    >
                        📅
                    </button>
                )}
            </div>
            {includeCustom && showCustom && (
                <div className="snooze-custom">
                    <input
                        type="datetime-local"
                        className="snooze-custom-input"
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                    />
                    <button
                        type="button"
                        className="snooze-chip snooze-chip--set"
                        onClick={() => customValid && onPick(customMs)}
                        disabled={!customValid}
                    >
                        Set
                    </button>
                </div>
            )}
        </div>
    );
};

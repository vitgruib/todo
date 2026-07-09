import React, { useState } from 'react';
import {
    DUE_PRESETS,
    DURATION_UNITS,
    DurationUnit,
    durationToRemindAt,
    toDateTimeLocalValue,
} from '../reminders';

interface TodoFormProps {
    onAdd: (title: string, remindAt?: number) => void;
}

const CUSTOM = 'custom';
const DURATION = 'duration';
const DEFAULT_PRESET_INDEX = 4; // 1 day

export const TodoForm: React.FC<TodoFormProps> = ({ onAdd }) => {
    const [title, setTitle] = useState('');
    const [taskType, setTaskType] = useState<'short-run' | 'long-run'>('short-run');
    const [dueSelection, setDueSelection] = useState<string>(
        DUE_PRESETS[DEFAULT_PRESET_INDEX].value,
    );
    const [customDueValue, setCustomDueValue] = useState<string>('');
    const [durationAmount, setDurationAmount] = useState<string>('');
    const [durationUnit, setDurationUnit] = useState<DurationUnit>('hours');

    const isCustom = dueSelection === CUSTOM;
    const isDuration = dueSelection === DURATION;

    const resolveRemindAt = (): number | undefined => {
        if (taskType === 'long-run') return undefined;
        if (isCustom) {
            const ms = new Date(customDueValue).getTime();
            return Number.isNaN(ms) ? undefined : ms;
        }
        if (isDuration) {
            return durationToRemindAt(durationAmount, durationUnit);
        }
        const preset = DUE_PRESETS.find((option) => option.value === dueSelection);
        return preset ? Date.now() + preset.ms : undefined;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        if (taskType === 'short-run' && isCustom && !customDueValue) return;
        if (
            taskType === 'short-run' &&
            isDuration &&
            durationToRemindAt(durationAmount, durationUnit) === undefined
        )
            return;
        onAdd(trimmed, resolveRemindAt());
        setTitle('');
    };

    return (
        <form onSubmit={handleSubmit} className="todo-form">
            <div className="todo-form-row">
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="What needs to be done?"
                    className="todo-input"
                    autoFocus
                />
                <button type="submit" className="add-btn">
                    Add
                </button>
            </div>
            <div className="todo-form-options">
                <div className="todo-type-toggle" role="group" aria-label="Task type">
                    <button
                        type="button"
                        className={`todo-type-btn ${taskType === 'short-run' ? 'todo-type-btn--active' : ''}`}
                        onClick={() => setTaskType('short-run')}
                    >
                        Short run
                    </button>
                    <button
                        type="button"
                        className={`todo-type-btn ${taskType === 'long-run' ? 'todo-type-btn--active' : ''}`}
                        onClick={() => setTaskType('long-run')}
                    >
                        Long term
                    </button>
                </div>
                {taskType === 'short-run' && (
                    <>
                        <select
                            className="todo-form-due-select"
                            value={dueSelection}
                            onChange={(e) => {
                                const value = e.target.value;
                                setDueSelection(value);
                                if (value === CUSTOM && !customDueValue) {
                                    setCustomDueValue(
                                        toDateTimeLocalValue(
                                            Date.now() + DUE_PRESETS[DEFAULT_PRESET_INDEX].ms,
                                        ),
                                    );
                                }
                            }}
                        >
                            {DUE_PRESETS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                            <option value={CUSTOM}>Pick a date &amp; time…</option>
                            <option value={DURATION}>Enter time until due…</option>
                        </select>
                        {isCustom && (
                            <input
                                type="datetime-local"
                                className="todo-form-due-custom"
                                value={customDueValue}
                                onChange={(e) => setCustomDueValue(e.target.value)}
                            />
                        )}
                        {isDuration && (
                            <span className="todo-form-due-duration">
                                <input
                                    type="number"
                                    min="1"
                                    className="todo-form-due-duration-amount"
                                    value={durationAmount}
                                    onChange={(e) => setDurationAmount(e.target.value)}
                                    placeholder="e.g. 90"
                                />
                                <select
                                    className="todo-form-due-duration-unit"
                                    value={durationUnit}
                                    onChange={(e) =>
                                        setDurationUnit(e.target.value as DurationUnit)
                                    }
                                >
                                    {DURATION_UNITS.map((unit) => (
                                        <option key={unit.value} value={unit.value}>
                                            {unit.label}
                                        </option>
                                    ))}
                                </select>
                            </span>
                        )}
                    </>
                )}
            </div>
        </form>
    );
};

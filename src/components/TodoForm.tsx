import React, { useState } from 'react';
import { DUE_PRESETS, toDateTimeLocalValue } from '../reminders';

interface TodoFormProps {
    onAdd: (title: string, remindAt?: number) => void;
}

const CUSTOM = 'custom';
const DEFAULT_PRESET_INDEX = 3; // 1 day

export const TodoForm: React.FC<TodoFormProps> = ({ onAdd }) => {
    const [title, setTitle] = useState('');
    const [taskType, setTaskType] = useState<'short-run' | 'long-run'>('short-run');
    const [dueSelection, setDueSelection] = useState<string>(DUE_PRESETS[DEFAULT_PRESET_INDEX].value);
    const [customDueValue, setCustomDueValue] = useState<string>('');

    const isCustom = dueSelection === CUSTOM;

    const resolveRemindAt = (): number | undefined => {
        if (taskType === 'long-run') return undefined;
        if (isCustom) {
            const ms = new Date(customDueValue).getTime();
            return Number.isNaN(ms) ? undefined : ms;
        }
        const preset = DUE_PRESETS.find((option) => option.value === dueSelection);
        return preset ? Date.now() + preset.ms : undefined;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        if (taskType === 'short-run' && isCustom && !customDueValue) return;
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
                                        toDateTimeLocalValue(Date.now() + DUE_PRESETS[DEFAULT_PRESET_INDEX].ms)
                                    );
                                }
                            }}
                        >
                            {DUE_PRESETS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                            <option value={CUSTOM}>Pick your own date…</option>
                        </select>
                        {isCustom && (
                            <input
                                type="datetime-local"
                                className="todo-form-due-custom"
                                value={customDueValue}
                                onChange={(e) => setCustomDueValue(e.target.value)}
                            />
                        )}
                    </>
                )}
            </div>
        </form>
    );
};

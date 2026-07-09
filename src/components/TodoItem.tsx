import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Todo } from '../types';
import { formatReminderTime, toDateTimeLocalValue, formatDueCaption, DUE_PRESETS, DURATION_UNITS, DurationUnit, durationToRemindAt } from '../reminders';

const CUSTOM = 'custom';
const DURATION = 'duration';
const DEFAULT_PRESET_INDEX = 4; // 1 day

interface TodoItemProps {
    todo: Todo;
    sectionId: string;
    now: number;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onUpdateTodo: (id: string, updates: Partial<Todo>) => void;
    onSetReminder: (todo: Todo, remindAt: number) => void;
    onClearReminder: (todo: Todo) => void;
}

export const TodoItem: React.FC<TodoItemProps> = ({
    todo,
    sectionId,
    now,
    onToggle,
    onDelete,
    onUpdateTodo,
    onSetReminder,
    onClearReminder,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(todo.title);
    const [focusMenuOpen, setFocusMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const [dueSelection, setDueSelection] = useState<string>(DUE_PRESETS[DEFAULT_PRESET_INDEX].value);
    const [customDueValue, setCustomDueValue] = useState<string>('');
    const [durationAmount, setDurationAmount] = useState<string>('');
    const [durationUnit, setDurationUnit] = useState<DurationUnit>('hours');
    const inputRef = useRef<HTMLInputElement>(null);
    const focusMenuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        setEditValue(todo.title);
    }, [todo.title]);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const PANEL_WIDTH_PX = 288;

    useLayoutEffect(() => {
        if (!focusMenuOpen || !triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const padding = 8;
        let left = rect.right - PANEL_WIDTH_PX;
        if (left < padding) left = padding;
        if (left + PANEL_WIDTH_PX > window.innerWidth - padding) left = window.innerWidth - PANEL_WIDTH_PX - padding;
        let top = rect.bottom + 6;
        const panelHeightEst = 320;
        if (top + panelHeightEst > window.innerHeight - padding) top = rect.top - panelHeightEst - 6;
        if (top < padding) top = padding;
        setMenuPosition({ top, left });
    }, [focusMenuOpen]);

    useEffect(() => {
        if (!focusMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (focusMenuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
            setFocusMenuOpen(false);
        };
        const handleScroll = () => setFocusMenuOpen(false);
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [focusMenuOpen]);

    const saveTitle = () => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== todo.title) {
            onUpdateTodo(todo.id, { title: trimmed });
        } else {
            setEditValue(todo.title);
        }
        setIsEditing(false);
    };

    const isShortRun = sectionId === 'short-run';
    const showDelayMarker = !!todo.delayCount;

    const commitDueSelection = () => {
        let ms: number;
        if (dueSelection === CUSTOM) {
            const parsed = new Date(customDueValue).getTime();
            if (Number.isNaN(parsed)) return;
            ms = parsed;
        } else if (dueSelection === DURATION) {
            const parsed = durationToRemindAt(durationAmount, durationUnit);
            if (parsed === undefined) return;
            ms = parsed;
        } else {
            const preset = DUE_PRESETS.find((option) => option.value === dueSelection);
            if (!preset) return;
            ms = Date.now() + preset.ms;
        }
        onSetReminder(todo, ms);
    };

    const resetDueSelection = () => {
        setDueSelection(DUE_PRESETS[DEFAULT_PRESET_INDEX].value);
        setCustomDueValue('');
        setDurationAmount('');
    };

    return (
        <div className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                    <div className="todo-header">
                        <input
                            type="checkbox"
                            checked={todo.completed}
                            onChange={() => onToggle(todo.id)}
                            className="todo-checkbox"
                        />
                        <div className="todo-content">
                            {isEditing ? (
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="todo-title-edit"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={saveTitle}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveTitle();
                                        if (e.key === 'Escape') {
                                            setEditValue(todo.title);
                                            setIsEditing(false);
                                        }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <>
                                    <h3
                                        onDoubleClick={(e) => {
                                            e.preventDefault();
                                            setIsEditing(true);
                                        }}
                                        title="Double-click to edit"
                                    >
                                        {todo.title}
                                    </h3>
                                    {isShortRun && todo.remindAt != null && (
                                        <span className="todo-days-caption">{formatDueCaption(todo.remindAt, now)}</span>
                                    )}
                                    {isShortRun && showDelayMarker && (
                                        <span className="todo-delay-badge">
                                            ⏳ Delayed {todo.delayCount}×
                                        </span>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="todo-focus-menu-wrap">
                            <button
                                ref={triggerRef}
                                type="button"
                                className="todo-focus-menu-trigger"
                                onClick={() => setFocusMenuOpen((o) => !o)}
                                aria-label="Options"
                                aria-expanded={focusMenuOpen}
                            >
                                ⋮
                            </button>
                            {focusMenuOpen &&
                                createPortal(
                                    <div
                                        ref={focusMenuRef}
                                        className="todo-focus-menu-panel todo-focus-menu-panel--portal"
                                        style={{ top: menuPosition.top, left: menuPosition.left, width: PANEL_WIDTH_PX }}
                                    >
                                        <div className="todo-focus-menu-timer-block">
                                            <div className="todo-focus-menu-timer-heading">
                                                {isShortRun ? 'Due date' : 'Long-term goal'}
                                            </div>
                                            {isShortRun && todo.remindAt != null && (
                                                <p className="todo-focus-menu-reminder-current">
                                                    Due {formatReminderTime(todo.remindAt)}
                                                </p>
                                            )}
                                            {isShortRun && showDelayMarker && (
                                                <p className="todo-focus-menu-delay-note">
                                                    Delayed {todo.delayCount}× already
                                                </p>
                                            )}
                                            <div className="todo-focus-menu-field">
                                                <label className="todo-focus-menu-label">
                                                    {isShortRun ? 'Change due date' : 'Give it a due date'}
                                                </label>
                                                <select
                                                    className="todo-focus-menu-input"
                                                    value={dueSelection}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        setDueSelection(value);
                                                        if (value === CUSTOM && !customDueValue) {
                                                            setCustomDueValue(
                                                                toDateTimeLocalValue(
                                                                    todo.remindAt ?? Date.now() + DUE_PRESETS[DEFAULT_PRESET_INDEX].ms
                                                                )
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
                                                {dueSelection === CUSTOM && (
                                                    <input
                                                        type="datetime-local"
                                                        className="todo-focus-menu-input todo-focus-menu-date"
                                                        value={customDueValue}
                                                        onChange={(e) => setCustomDueValue(e.target.value)}
                                                    />
                                                )}
                                                {dueSelection === DURATION && (
                                                    <span className="todo-focus-menu-duration">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            className="todo-focus-menu-input todo-focus-menu-duration-amount"
                                                            value={durationAmount}
                                                            onChange={(e) => setDurationAmount(e.target.value)}
                                                            placeholder="e.g. 90"
                                                        />
                                                        <select
                                                            className="todo-focus-menu-input todo-focus-menu-duration-unit"
                                                            value={durationUnit}
                                                            onChange={(e) => setDurationUnit(e.target.value as DurationUnit)}
                                                        >
                                                            {DURATION_UNITS.map((unit) => (
                                                                <option key={unit.value} value={unit.value}>
                                                                    {unit.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                className="todo-focus-menu-start"
                                                onClick={() => {
                                                    commitDueSelection();
                                                    resetDueSelection();
                                                    setFocusMenuOpen(false);
                                                }}
                                                disabled={
                                                    (dueSelection === CUSTOM && !customDueValue) ||
                                                    (dueSelection === DURATION &&
                                                        durationToRemindAt(durationAmount, durationUnit) === undefined)
                                                }
                                            >
                                                {isShortRun ? 'Update due date' : 'Move to short run'}
                                            </button>
                                            {isShortRun && (
                                                <button
                                                    type="button"
                                                    className="todo-focus-menu-item"
                                                    onClick={() => { onClearReminder(todo); resetDueSelection(); setFocusMenuOpen(false); }}
                                                >
                                                    Relegate to long-term goal
                                                </button>
                                            )}
                                        </div>
                                        <div className="todo-focus-menu-divider" />
                                        <button type="button" className="todo-focus-menu-item todo-focus-menu-item--danger" onClick={() => { onDelete(todo.id); setFocusMenuOpen(false); }}>
                                            Delete
                                        </button>
                                    </div>,
                                    document.body
                                )}
                        </div>
                    </div>
        </div>
    );
};

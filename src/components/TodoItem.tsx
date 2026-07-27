import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Todo } from '../types';
import { formatReminderTime, formatDueCaption } from '../reminders';
import { SnoozeChips } from './SnoozeChips';

interface TodoItemProps {
    todo: Todo;
    sectionId: string;
    now: number;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onUpdateTodo: (id: string, updates: Partial<Todo>) => void;
    onSetReminder: (todo: Todo, remindAt: number) => void;
    onClearReminder: (todo: Todo) => void;
    onRequestUrgent: (onConfirm: () => void) => void;
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
    onRequestUrgent,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(todo.title);
    const [focusMenuOpen, setFocusMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
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
        if (left + PANEL_WIDTH_PX > window.innerWidth - padding)
            left = window.innerWidth - PANEL_WIDTH_PX - padding;
        let top = rect.bottom + 6;
        const panelHeightEst = 320;
        if (top + panelHeightEst > window.innerHeight - padding)
            top = rect.top - panelHeightEst - 6;
        if (top < padding) top = padding;
        setMenuPosition({ top, left });
    }, [focusMenuOpen]);

    useEffect(() => {
        if (!focusMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (focusMenuRef.current?.contains(target) || triggerRef.current?.contains(target))
                return;
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
    // Urgent tasks can't be delayed, so an urgent task never shows the "delayed" look — even if it
    // carried a delay count from before it was marked urgent (removing urgent brings it back).
    const showDelayMarker = !todo.urgent && !!todo.delayCount;
    // Each push-back tints the task a step more dire; cap the ramp so it stays readable.
    const DELAY_LEVEL_CAP = 5;
    const delayLevel =
        isShortRun && !todo.urgent ? Math.min(todo.delayCount ?? 0, DELAY_LEVEL_CAP) : 0;

    // Urgent tasks can be snoozed like any other — doing so just drops the urgent flag (handled in
    // App's setReminder), so there's nothing to lock here.
    const canSnooze = isShortRun;

    const toggleUrgent = () => {
        if (todo.urgent) {
            onUpdateTodo(todo.id, { urgent: false });
        } else {
            onRequestUrgent(() => onUpdateTodo(todo.id, { urgent: true }));
        }
    };

    return (
        <div
            className={`todo-item ${todo.completed ? 'completed' : ''} ${todo.urgent ? 'todo-item--urgent' : ''}`}
            data-delay-level={delayLevel > 0 ? delayLevel : undefined}
            style={
                delayLevel > 0
                    ? ({ '--delay-level': delayLevel } as React.CSSProperties)
                    : undefined
            }
        >
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
                                onClick={() => setIsEditing(true)}
                                title="Click to edit"
                                className="todo-title"
                            >
                                {todo.urgent && <span className="todo-urgent-badge">URGENT</span>}
                                {todo.title}
                            </h3>
                            {isShortRun && todo.remindAt != null && (
                                <span className="todo-days-caption">
                                    {formatDueCaption(todo.remindAt, now)}
                                </span>
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
                                style={{
                                    top: menuPosition.top,
                                    left: menuPosition.left,
                                    width: PANEL_WIDTH_PX,
                                }}
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
                                    {todo.urgent && (
                                        <p className="todo-focus-menu-urgent-note">
                                            🔴 Urgent. Pushing the deadline back removes the urgent
                                            flag.
                                        </p>
                                    )}
                                    <label className="todo-focus-menu-label">
                                        {isShortRun ? 'Snooze / change due' : 'Give a due date'}
                                    </label>
                                    <SnoozeChips
                                        includeCustom
                                        customSeed={todo.remindAt}
                                        remindAt={todo.remindAt}
                                        onPick={(ms) => {
                                            onSetReminder(todo, ms);
                                            setFocusMenuOpen(false);
                                        }}
                                    />
                                    {isShortRun && (
                                        <button
                                            type="button"
                                            className="todo-focus-menu-item"
                                            onClick={() => {
                                                onClearReminder(todo);
                                                setFocusMenuOpen(false);
                                            }}
                                        >
                                            Relegate to long-term goal
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="todo-focus-menu-item todo-focus-menu-item--urgent"
                                        onClick={() => {
                                            toggleUrgent();
                                            setFocusMenuOpen(false);
                                        }}
                                    >
                                        {todo.urgent ? 'Remove urgent' : '🔴 Mark urgent'}
                                    </button>
                                </div>
                                <div className="todo-focus-menu-divider" />
                                <button
                                    type="button"
                                    className="todo-focus-menu-item todo-focus-menu-item--danger"
                                    onClick={() => {
                                        onDelete(todo.id);
                                        setFocusMenuOpen(false);
                                    }}
                                >
                                    Delete
                                </button>
                            </div>,
                            document.body,
                        )}
                </div>
            </div>

            {/* One-tap quick actions, revealed on hover/focus so the resting row stays clean. */}
            <div className="todo-quick-actions">
                {canSnooze && (
                    <SnoozeChips
                        className="snooze-chips--inline"
                        remindAt={todo.remindAt}
                        onPick={(ms) => onSetReminder(todo, ms)}
                    />
                )}
                <button
                    type="button"
                    className={`quick-urgent ${todo.urgent ? 'quick-urgent--on' : ''}`}
                    onClick={toggleUrgent}
                    title={todo.urgent ? 'Remove urgent' : 'Mark urgent'}
                >
                    {todo.urgent ? '⚪ Remove urgent' : '🔴 Urgent'}
                </button>
            </div>
        </div>
    );
};

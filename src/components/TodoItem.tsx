import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Draggable } from '@hello-pangea/dnd';
import { Todo } from '../types';

const MIN_TIMER_MINUTES = 1;
const MAX_TIMER_MINUTES = 480;
const MIN_CHECKINS = 1;
const MAX_CHECKINS = 20;

interface TodoItemProps {
    todo: Todo;
    index: number;
    sectionId: string;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onUpdateTodo: (id: string, updates: Partial<Todo>) => void;
    activeTimerTaskId: string | null;
    onStartTimer: (taskId: string, taskTitle: string, timerMinutes: number, checkInCount: number) => void;
}

function formatAddedToFocus(ts: number): string {
    const now = Date.now();
    const diffMs = now - ts;
    const diffM = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);
    if (diffM < 1) return 'Just now';
    if (diffM < 60) return `${diffM}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    if (diffD < 7) return `${diffD}d ago`;
    const diffW = Math.floor(diffD / 7);
    return diffW < 4 ? `${diffW}w ago` : `${diffD}d ago`;
}

/** Compact "days since added" for caption under title (no date) */
function daysSinceAdded(ts: number): string {
    const diffMs = Date.now() - ts;
    const diffD = Math.floor(diffMs / 86400000);
    const diffW = Math.floor(diffD / 7);
    if (diffD < 1) return 'Today';
    if (diffD === 1) return '1d';
    if (diffD < 7) return `${diffD}d`;
    if (diffW < 4) return `${diffW}w`;
    return `${diffD}d`;
}

export const TodoItem: React.FC<TodoItemProps> = ({
    todo,
    index,
    sectionId,
    onToggle,
    onDelete,
    onUpdateTodo,
    activeTimerTaskId,
    onStartTimer,
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

    const PANEL_WIDTH_PX = 224;

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

    const isFocus = sectionId === 'focus';
    const todayStr = (() => {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    })();
    const refreshDate = () => {
        onUpdateTodo(todo.id, { deadline: todayStr, addedToFocusAt: Date.now(), bumpSentAt: undefined });
    };
    const timerMinutes = Math.max(MIN_TIMER_MINUTES, Math.min(MAX_TIMER_MINUTES, todo.timerMinutes ?? 25));
    const checkInCount = Math.max(MIN_CHECKINS, Math.min(MAX_CHECKINS, todo.checkInCount ?? 2));
    const isThisTimerRunning = activeTimerTaskId === todo.id;
    const isOtherTimerRunning = activeTimerTaskId != null && activeTimerTaskId !== todo.id;

    const startTimer = useCallback(() => {
        if (timerMinutes < 1 || checkInCount < 1 || isOtherTimerRunning) return;
        onStartTimer(todo.id, todo.title, timerMinutes, checkInCount);
        setFocusMenuOpen(false);
    }, [todo.id, todo.title, timerMinutes, checkInCount, isOtherTimerRunning, onStartTimer]);

    return (
        <Draggable draggableId={todo.id} index={index}>
            {(provided) => (
                <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    className={`todo-item ${todo.completed ? 'completed' : ''}`}
                >
                    <div className="todo-header">
                        <span className="todo-grip" {...provided.dragHandleProps} aria-hidden title="Drag from grip">⋮⋮</span>
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
                                    {isFocus && todo.addedToFocusAt != null && (
                                        <span className="todo-days-caption">{daysSinceAdded(todo.addedToFocusAt)}</span>
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
                                        {isFocus && (
                                            <>
                                                {todo.addedToFocusAt != null && (
                                                    <p className="todo-focus-menu-added">
                                                        {formatAddedToFocus(todo.addedToFocusAt)}
                                                    </p>
                                                )}
                                                <button type="button" className="todo-focus-menu-item" onClick={() => { refreshDate(); setFocusMenuOpen(false); }}>
                                                    Refresh date
                                                </button>
                                                <div className="todo-focus-menu-divider" />
                                                <div className="todo-focus-menu-timer-block">
                                                    <div className="todo-focus-menu-timer-heading">Timer</div>
                                                    <div className="todo-focus-menu-field">
                                                        <label className="todo-focus-menu-label">Duration (minutes)</label>
                                                        <input
                                                            type="number"
                                                            className="todo-focus-menu-input"
                                                            min={MIN_TIMER_MINUTES}
                                                            max={MAX_TIMER_MINUTES}
                                                            value={timerMinutes}
                                                            onChange={(e) => {
                                                                const v = parseInt(e.target.value, 10);
                                                                if (!Number.isNaN(v)) onUpdateTodo(todo.id, { timerMinutes: Math.max(MIN_TIMER_MINUTES, Math.min(MAX_TIMER_MINUTES, v)) });
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="todo-focus-menu-field">
                                                        <label className="todo-focus-menu-label">Check-ins</label>
                                                        <input
                                                            type="number"
                                                            className="todo-focus-menu-input"
                                                            min={MIN_CHECKINS}
                                                            max={MAX_CHECKINS}
                                                            value={checkInCount}
                                                            onChange={(e) => {
                                                                const v = parseInt(e.target.value, 10);
                                                                if (!Number.isNaN(v)) onUpdateTodo(todo.id, { checkInCount: Math.max(MIN_CHECKINS, Math.min(MAX_CHECKINS, v)) });
                                                            }}
                                                        />
                                                    </div>
                                                    {isOtherTimerRunning && (
                                                        <p className="todo-focus-menu-hint">One timer at a time.</p>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="todo-focus-menu-start"
                                                        onClick={startTimer}
                                                        disabled={isOtherTimerRunning || isThisTimerRunning}
                                                        title={isThisTimerRunning ? 'Timer running' : isOtherTimerRunning ? 'One timer at a time' : undefined}
                                                    >
                                                        {isThisTimerRunning ? 'Timer running' : 'Start timer'}
                                                    </button>
                                                </div>
                                                <div className="todo-focus-menu-divider" />
                                            </>
                                        )}
                                        <button type="button" className="todo-focus-menu-item todo-focus-menu-item--danger" onClick={() => { onDelete(todo.id); setFocusMenuOpen(false); }}>
                                            Delete
                                        </button>
                                    </div>,
                                    document.body
                                )}
                        </div>
                    </div>
                </div>
            )}
        </Draggable>
    );
};

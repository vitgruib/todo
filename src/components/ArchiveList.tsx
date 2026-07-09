import React, { useMemo, useState } from 'react';
import { Todo } from '../types';
import { formatCompletedAt } from '../reminders';

interface ArchiveListProps {
    archivedTodos: Todo[];
    now: number;
    onRestore: (id: string) => void;
    onDelete: (id: string) => void;
    onClear: () => void;
}

export const ArchiveList: React.FC<ArchiveListProps> = ({
    archivedTodos,
    now,
    onRestore,
    onDelete,
    onClear,
}) => {
    const [isOpen, setIsOpen] = useState(false);

    // Most recently completed first — a stable, strict completion-order sort.
    const ordered = useMemo(
        () => [...archivedTodos].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
        [archivedTodos],
    );

    return (
        <div className="archive-section">
            <button
                type="button"
                className="archive-toggle"
                onClick={() => setIsOpen((o) => !o)}
                aria-expanded={isOpen}
            >
                <span>{isOpen ? '▾' : '▸'} Archive</span>
                <span className="archive-count">{archivedTodos.length}</span>
            </button>

            {isOpen && (
                <div className="archive-body">
                    {ordered.length === 0 ? (
                        <p className="section-empty">No completed tasks yet.</p>
                    ) : (
                        <>
                            <div className="archive-list">
                                {ordered.map((todo) => (
                                    <div key={todo.id} className="archive-item">
                                        <div className="archive-item-main">
                                            <span className="archive-item-title">{todo.title}</span>
                                            {todo.completedAt != null && (
                                                <span className="archive-item-time">
                                                    Completed{' '}
                                                    {formatCompletedAt(todo.completedAt, now)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="archive-item-actions">
                                            <button
                                                type="button"
                                                className="archive-item-btn"
                                                onClick={() => onRestore(todo.id)}
                                            >
                                                Restore
                                            </button>
                                            <button
                                                type="button"
                                                className="archive-item-btn archive-item-btn--danger"
                                                onClick={() => onDelete(todo.id)}
                                                aria-label={`Delete ${todo.title} permanently`}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button type="button" className="archive-clear" onClick={onClear}>
                                Clear archive
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

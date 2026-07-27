import React from 'react';
import { Todo } from '../types';
import { TodoItem } from './TodoItem';

interface TodoListProps {
    todos: Todo[];
    now: number;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onUpdateTodo: (id: string, updates: Partial<Todo>) => void;
    onSetReminder: (todo: Todo, remindAt: number) => void;
    onClearReminder: (todo: Todo) => void;
    onRequestUrgent: (onConfirm: () => void) => void;
}

export const TodoList: React.FC<TodoListProps> = ({
    todos,
    now,
    onToggle,
    onDelete,
    onUpdateTodo,
    onSetReminder,
    onClearReminder,
    onRequestUrgent,
}) => {
    const getSectionId = (todo: Todo): 'short-run' | 'long-run' =>
        typeof todo.remindAt === 'number' ? 'short-run' : 'long-run';

    const sections = {
        'short-run': {
            title: 'Short run',
            empty: 'No short-run tasks. Add one and it gets a due date.',
            items: [] as Todo[],
        },
        'long-run': { title: 'Long run', empty: 'No long-term goals yet.', items: [] as Todo[] },
    };

    todos.forEach((todo) => {
        sections[getSectionId(todo)].items.push(todo);
    });

    // Short-run tasks: urgent first, then by due date (soonest / most overdue first).
    sections['short-run'].items.sort((a, b) => {
        if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1;
        return (a.remindAt ?? 0) - (b.remindAt ?? 0);
    });
    // Long-run goals: float urgent ones to the top, otherwise keep insertion order (stable sort).
    sections['long-run'].items.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));

    return (
        <div className="todo-sections">
            {Object.entries(sections).map(([id, section]) => (
                <div key={id} className="todo-section-group">
                    <h2 className="section-title">{section.title}</h2>
                    <div className="section-list">
                        {section.items.length === 0 ? (
                            <p className="section-empty">{section.empty}</p>
                        ) : (
                            section.items.map((todo) => (
                                <TodoItem
                                    key={todo.id}
                                    todo={todo}
                                    sectionId={id}
                                    now={now}
                                    onToggle={onToggle}
                                    onDelete={onDelete}
                                    onUpdateTodo={onUpdateTodo}
                                    onSetReminder={onSetReminder}
                                    onClearReminder={onClearReminder}
                                    onRequestUrgent={onRequestUrgent}
                                />
                            ))
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

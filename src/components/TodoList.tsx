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
}

export const TodoList: React.FC<TodoListProps> = ({
    todos,
    now,
    onToggle,
    onDelete,
    onUpdateTodo,
    onSetReminder,
    onClearReminder,
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

    // Short-run tasks are always sorted by due date (soonest / most overdue first).
    sections['short-run'].items.sort((a, b) => (a.remindAt ?? 0) - (b.remindAt ?? 0));

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
                                />
                            ))
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

import React, { useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Todo } from '../types';

interface TodoItemProps {
    todo: Todo;
    index: number;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onAddStep: (id: string, title: string) => void;
    onToggleStep: (todoId: string, stepId: string) => void;
}

export const TodoItem: React.FC<TodoItemProps> = ({
    todo,
    index,
    onToggle,
    onDelete,
    onAddStep,
    onToggleStep,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [newStepTitle, setNewStepTitle] = useState('');

    const handleAddStep = (e: React.FormEvent) => {
        e.preventDefault();
        if (newStepTitle.trim()) {
            onAddStep(todo.id, newStepTitle);
            setNewStepTitle('');
        }
    };

    return (
        <Draggable draggableId={todo.id} index={index}>
            {(provided) => (
                <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={`todo-item ${todo.completed ? 'completed' : ''}`}
                >
                    <div className="todo-header">
                        <input
                            type="checkbox"
                            checked={todo.completed}
                            onChange={() => onToggle(todo.id)}
                            className="todo-checkbox"
                        />
                        <div className="todo-content" onClick={() => setIsExpanded(!isExpanded)}>
                            <h3>{todo.title}</h3>
                        </div>
                        <button onClick={() => onDelete(todo.id)} className="delete-btn">
                            &times;
                        </button>
                    </div>

                    {isExpanded && (
                        <div className="todo-details">
                            <ul className="steps-list">
                                {todo.steps.map((step) => (
                                    <li key={step.id} className="step-item">
                                        <input
                                            type="checkbox"
                                            checked={step.completed}
                                            onChange={() => onToggleStep(todo.id, step.id)}
                                        />
                                        <span className={step.completed ? 'completed' : ''}>
                                            {step.title}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <form onSubmit={handleAddStep} className="step-form">
                                <input
                                    type="text"
                                    value={newStepTitle}
                                    onChange={(e) => setNewStepTitle(e.target.value)}
                                    placeholder="Add a step..."
                                />
                                <button type="submit">+</button>
                            </form>
                        </div>
                    )}
                </div>
            )}
        </Draggable>
    );
};

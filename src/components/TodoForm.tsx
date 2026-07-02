import React, { useState } from 'react';

interface TodoFormProps {
    onAdd: (title: string) => void;
}

export const TodoForm: React.FC<TodoFormProps> = ({ onAdd }) => {
    const [title, setTitle] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (title.trim()) {
            onAdd(title.trim());
            setTitle('');
        }
    };

    return (
        <form onSubmit={handleSubmit} className="todo-form">
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
        </form>
    );
};

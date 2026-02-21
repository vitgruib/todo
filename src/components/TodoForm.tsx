import React, { useState } from 'react';

interface TodoFormProps {
    onAdd: (title: string, deadline?: string) => void;
}

export const TodoForm: React.FC<TodoFormProps> = ({ onAdd }) => {
    const [title, setTitle] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (title.trim()) {
            // Default to today (Focus) using LOCAL time
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const today = `${year}-${month}-${day}`;

            onAdd(title, today);
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

import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Todo } from '../types';

const STORAGE_KEY = 'todo-ai-data-v2';

export const useTodos = () => {
    const [todos, setTodos] = useState<Todo[]>([]);

    // Helper: is this todo in Focus (today or overdue)?
    const isFocusSection = (t: Todo) => {
        if (!t.deadline) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const d = new Date(t.deadline + 'T00:00:00');
        const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diff <= 0;
    };

    // Load from storage on mount; backfill addedToFocusAt for focus tasks that don't have it
    useEffect(() => {
        const normalize = (loaded: Todo[]) => {
            return loaded.map((t) => {
                if (isFocusSection(t) && t.addedToFocusAt == null) {
                    return { ...t, addedToFocusAt: t.createdAt };
                }
                return t;
            });
        };
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                if (result[STORAGE_KEY]) {
                    setTodos(normalize(result[STORAGE_KEY]));
                }
            });
        } else {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                setTodos(normalize(JSON.parse(saved)));
            }
        }
    }, []);

    // Save to storage whenever todos change
    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [STORAGE_KEY]: todos });
        } else {
            // Fallback for local dev
            localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
        }
    }, [todos]);

    const addTodo = (title: string, deadline?: string) => {
        const now = Date.now();
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const newTodo: Todo = {
            id: uuidv4(),
            title,
            completed: false,
            deadline,
            steps: [],
            createdAt: now,
            addedToFocusAt: deadline && deadline <= todayStr ? now : undefined,
        };
        setTodos((prev) => [newTodo, ...prev]);
    };

    const deleteTodo = (id: string) => {
        setTodos((prev) => prev.filter((t) => t.id !== id));
    };

    const toggleTodo = (id: string, options?: { deleteIfCompleted?: boolean }) => {
        setTodos((prev) => {
            const next = prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
            const updated = next.find((t) => t.id === id);
            if (updated?.completed && options?.deleteIfCompleted) {
                return next.filter((t) => t.id !== id);
            }
            return next;
        });
    };

    const updateTodo = (id: string, updates: Partial<Todo>) => {
        setTodos((prev) =>
            prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
        );
    };

    const reorderTodos = (result: any) => {
        const { destination, draggableId } = result;

        // Dropped outside the list
        if (!destination) {
            return;
        }

        // Logic to calculate the new date based on the destination ID
        let newDeadline: string | undefined;
        const today = new Date();

        // Helper to format date as YYYY-MM-DD in LOCAL time
        const formatDate = (d: Date) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Helper to add days
        const addDays = (date: Date, days: number) => {
            const result = new Date(date);
            result.setDate(result.getDate() + days);
            return formatDate(result);
        };

        switch (destination.droppableId) {
            case 'focus':
                newDeadline = addDays(today, 0);
                break;
            case 'up-next':
                newDeadline = addDays(today, 1);
                break;
            case 'someday':
                newDeadline = undefined;
                break;
            default:
                return;
        }

        setTodos((prevTodos) => {
            const newTodos = Array.from(prevTodos);
            const movedTodoIndex = newTodos.findIndex(t => t.id === draggableId);
            if (movedTodoIndex === -1) return prevTodos;

            const [movedTodo] = newTodos.splice(movedTodoIndex, 1);

            const getSectionId = (t: Todo) => {
                if (!t.deadline) return 'someday';
                const d = new Date(t.deadline + 'T00:00:00');
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                if (diff <= 0) return 'focus';
                if (diff === 1) return 'up-next';
                return 'someday';
            };
            const now = Date.now();
            const wasFocus = getSectionId(movedTodo) === 'focus';
            const willBeFocus = destination.droppableId === 'focus';
            const updatedTodo: Todo = {
                ...movedTodo,
                deadline: newDeadline,
                addedToFocusAt: willBeFocus ? now : wasFocus ? undefined : movedTodo.addedToFocusAt,
            };

            const sections: Record<string, Todo[]> = {
                'focus': [],
                'up-next': [],
                'someday': []
            };

            // Distribute remaining todos
            newTodos.forEach(t => {
                const sec = getSectionId(t);
                if (sections[sec]) sections[sec].push(t);
                else sections['someday'].push(t);
            });

            // Insert the moved todo into the target section
            if (sections[destination.droppableId]) {
                sections[destination.droppableId].splice(destination.index, 0, updatedTodo);
            }

            // Flatten
            return [
                ...sections['focus'],
                ...sections['up-next'],
                ...sections['someday']
            ];
        });
    };

    return {
        todos,
        addTodo,
        deleteTodo,
        toggleTodo,
        updateTodo,
        reorderTodos,
    };
};

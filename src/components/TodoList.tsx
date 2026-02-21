import React from 'react';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { Todo } from '../types';
import { TodoItem } from './TodoItem';

interface TodoListProps {
    todos: Todo[];
    onReorder: (result: any) => void;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onAddStep: (id: string, title: string) => void;
    onToggleStep: (todoId: string, stepId: string) => void;
}

export const TodoList: React.FC<TodoListProps> = ({
    todos,
    onReorder,
    onToggle,
    onDelete,
    onAddStep,
    onToggleStep,
}) => {
    const getSectionId = (todo: Todo) => {
        if (!todo.deadline) return 'someday';

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const deadlineDate = new Date(todo.deadline + 'T00:00:00');

        const diffTime = deadlineDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) return 'focus';   // Today & Overdue
        if (diffDays === 1) return 'up-next'; // Tomorrow
        return 'someday'; // Everything else implies "Later" or "Someday"
    };


    const sections = {
        'focus': { title: 'Focus', items: [] as Todo[] },
        'up-next': { title: 'Up Next', items: [] as Todo[] },
        'someday': { title: 'Someday', items: [] as Todo[] },
    };

    // Sort todos into sections
    todos.forEach(todo => {
        const section = getSectionId(todo);
        if (sections[section as keyof typeof sections]) {
            sections[section as keyof typeof sections].items.push(todo);
        } else {
            // Fallback
            sections['someday'].items.push(todo);
        }
    });

    const handleDragEnd = (result: DropResult) => {
        onReorder(result);
    };

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <div className="todo-sections">
                {Object.entries(sections).map(([id, section]) => (
                    <div key={id} className="todo-section-group">
                        <h2 className="section-title">{section.title}</h2>
                        <Droppable droppableId={id}>
                            {(provided, snapshot) => (
                                <div
                                    {...provided.droppableProps}
                                    ref={provided.innerRef}
                                    className={`section-list ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                                >
                                    {section.items.map((todo, index) => (
                                        <TodoItem
                                            key={todo.id}
                                            todo={todo}
                                            index={index}
                                            onToggle={onToggle}
                                            onDelete={onDelete}
                                            onAddStep={onAddStep}
                                            onToggleStep={onToggleStep}
                                        />
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </div>
                ))}
            </div>
        </DragDropContext >
    );
};

export interface Step {
    id: string;
    title: string;
    completed: boolean;
}

export interface Todo {
    id: string;
    title: string;
    completed: boolean;
    deadline?: string;
    steps: Step[];
    createdAt: number;
}

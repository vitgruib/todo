export interface Step {
    id: string;
    title: string;
    completed: boolean;
}

export interface Todo {
    id: string;
    title: string;
    completed: boolean;
    steps: Step[];
    createdAt: number;
    /**
     * Epoch ms due date. Present => "Short run" task (has a due date that can expire).
     * Absent => "Long run" long-term goal (no due date).
     */
    remindAt?: number;
}

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
    /** When the task was last moved into Focus (drives the "days since added" caption) */
    addedToFocusAt?: number;
    /** Epoch ms for a "do now" reminder. When it passes, a popup asks you to do it or set a new deadline. */
    remindAt?: number;
}

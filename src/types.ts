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
    /** Minutes to run when starting a task timer */
    timerMinutes?: number;
    /** Number of check-ins during the timer (evenly spaced) */
    checkInCount?: number;
    /** When the task was last moved into Focus (for bump-after duration) */
    addedToFocusAt?: number;
    /** When we last sent a "bump" nudge for this task in focus */
    bumpSentAt?: number;
}

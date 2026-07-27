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
    /**
     * How many times this task's due date has been pushed back while it stayed short-run.
     * Resets to 0 when relegated to a long-term goal.
     */
    delayCount?: number;
    /**
     * Marked urgent by the user. Urgent tasks are extra-highlighted and can't be delayed
     * (their deadline can't be pushed later). Cleared when relegated to a long-term goal.
     */
    urgent?: boolean;
    /**
     * Epoch ms the task was completed. Only set on archived tasks; drives the
     * archive's completion-order sort. Absent on active tasks.
     */
    completedAt?: number;
    /**
     * Epoch ms this record was last changed on any device. Used to resolve cross-device conflicts
     * (newest write wins). Absent on tasks created before sync existed — merge falls back to
     * completedAt/createdAt for those.
     */
    updatedAt?: number;
    /** Epoch ms when a push-back was last counted; rapid extensions share one delay count. */
    lastDelayedAt?: number;
}

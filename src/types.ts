export interface Step {
    id: string;
    title: string;
    completed: boolean;
}

/** Controls whether/how the delay marker & remarks show up when a task's due date gets pushed back. */
export type PushBackReminders = 'none' | 'normal' | 'snarky';

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
     * Epoch ms the task was completed. Only set on archived tasks; drives the
     * archive's completion-order sort. Absent on active tasks.
     */
    completedAt?: number;
}

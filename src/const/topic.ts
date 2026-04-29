/**
 * Well-known `topic.trigger` values used to segment system-owned topics.
 *
 * `RunTask` is what `TaskRunnerService` writes when starting an agent run for
 * a task; the literal `'task'` is intentional and matches existing DB rows.
 */
export const TopicTrigger = {
  Cron: 'cron',
  Eval: 'eval',
  RunTask: 'task',
} as const;

/**
 * Triggers to exclude from the main chat sidebar so system-owned topics
 * (cron jobs, evals, task runs) don't pollute the user's main history.
 */
export const MAIN_SIDEBAR_EXCLUDE_TRIGGERS: string[] = [
  TopicTrigger.Cron,
  TopicTrigger.Eval,
  TopicTrigger.RunTask,
];

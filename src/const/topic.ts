/**
 * Well-known `topic.trigger` values used to segment the same agent's topics
 * across different panels (Task Manager vs. main chat).
 */
export const TopicTrigger = {
  Cron: 'cron',
  Eval: 'eval',
  RunTask: 'run_task',
  TaskManager: 'task_manager',
} as const;

/**
 * Triggers to exclude from the main chat sidebar so page-owned topics
 * (cron jobs, evals, task manager) don't pollute the user's main history.
 */
export const MAIN_SIDEBAR_EXCLUDE_TRIGGERS: string[] = [
  TopicTrigger.Cron,
  TopicTrigger.Eval,
  TopicTrigger.TaskManager,
  TopicTrigger.RunTask,
];

/**
 * Triggers the Task Manager panel fetches.
 */
export const TASK_MANAGER_INCLUDE_TRIGGERS: string[] = [TopicTrigger.TaskManager];

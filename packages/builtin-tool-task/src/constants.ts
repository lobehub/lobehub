export const TASK_STATUSES = [
  'backlog',
  'running',
  'scheduled',
  'paused',
  'completed',
  'failed',
  'canceled',
] as const;

export const UNFINISHED_TASK_STATUSES = ['backlog', 'running', 'scheduled', 'paused'] as const;

/** Look-back windows a task list can keep completed and canceled tasks for. */
export const TASK_COMPLETED_WINDOWS = ['day', 'week', 'month'] as const;

export type TaskCompletedWindow = (typeof TASK_COMPLETED_WINDOWS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export const TASK_COMPLETED_WINDOW_MS: Record<TaskCompletedWindow, number> = {
  day: DAY_MS,
  month: 30 * DAY_MS,
  week: 7 * DAY_MS,
};

/** Tool result for a create call without a usable `name` (required by the manifest). */
export const MISSING_TASK_NAME_ERROR =
  'Task not created: `name` is required. Pass a short, descriptive name for the task and call again.';

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

/** Tool result for a create call without a usable `name` (required by the manifest). */
export const MISSING_TASK_NAME_ERROR =
  'Task not created: `name` is required. Pass a short, descriptive name for the task and call again.';

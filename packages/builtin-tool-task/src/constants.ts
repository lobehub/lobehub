export const TASK_STATUSES = [
  'backlog',
  'running',
  'paused',
  'completed',
  'failed',
  'canceled',
] as const;

export const UNFINISHED_TASK_STATUSES = ['backlog', 'running', 'paused'] as const;

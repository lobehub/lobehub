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

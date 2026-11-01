/** The task fields that decide whether it may still run on its own. */
export interface TaskArchiveGuardInput {
  automationMode?: string | null;
  heartbeatInterval?: number | null;
  schedulePattern?: string | null;
  status: string;
}

const TERMINAL_STATUSES = new Set(['canceled', 'completed', 'failed']);

/**
 * Whether archiving would hide work that is still live: a task mid-run, or one
 * whose schedule / heartbeat can still fire. Archived tasks drop out of every
 * list, so such a task would keep executing where nobody can see or stop it.
 *
 * The automation half mirrors `RUNNABLE_AUTOMATION` in
 * `packages/database/src/models/taskListFilters.ts`, except that a paused
 * schedule is not live: the schedule dispatcher and tick both skip paused
 * tasks (heartbeat ticks do not). `TaskArchiveModel` applies the same rule.
 */
export const isTaskArchiveBlocked = (task: TaskArchiveGuardInput): boolean => {
  if (task.status === 'running') return true;
  if (TERMINAL_STATUSES.has(task.status)) return false;
  if (task.automationMode === 'schedule') return task.status !== 'paused' && !!task.schedulePattern;
  if (task.automationMode === 'heartbeat') return (task.heartbeatInterval ?? 0) > 0;
  return false;
};

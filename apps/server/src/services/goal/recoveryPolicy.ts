import type { GoalItem } from '@lobechat/types';

const DEFAULT_MAX_ATTEMPTS_PER_TASK = 3;
/**
 * Conservative on purpose: enough to stop independent Tasks queueing behind one
 * another, low enough that a goal cannot empty its budget in one fan-out before
 * anyone sees a result.
 */
const DEFAULT_MAX_CONCURRENT_TASKS = 3;
const MAX_CONCURRENT_TASKS_CEILING = 10;
const DEFAULT_OPERATION_LEASE_TIMEOUT_MS = 5 * 60 * 1000;
// Agent runtime refreshes the durable operation lease every third 30-second
// step-lock heartbeat. Keep the timeout above two durable heartbeat intervals
// so a transient missed write cannot reclaim a healthy operation.
export const MIN_OPERATION_LEASE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * How long a delivered Task may sit with verification pending before the
 * coordinator treats the delivery as abandoned and re-dispatches. The verify
 * judge is a full agent run — tens of minutes on a large delivery — so this
 * sits far above the operation lease, which is scaled to heartbeat gaps, not
 * judgments.
 */
export const VERIFY_SETTLE_GRACE_MS = 60 * 60 * 1000;

/** How many attempts one Task gets before the coordinator opens a decision gate. */
export const resolveTaskAttemptBudget = (goal: GoalItem): number => {
  const configured = goal.config?.recovery?.maxAttemptsPerTask;
  if (typeof configured === 'number') return Math.max(1, configured);
  return DEFAULT_MAX_ATTEMPTS_PER_TASK;
};

/** How many of this goal's Tasks may run at once. */
export const resolveMaxConcurrentTasks = (goal: GoalItem): number => {
  const configured = goal.config?.maxConcurrentTasks;
  if (typeof configured !== 'number') return DEFAULT_MAX_CONCURRENT_TASKS;
  return Math.min(MAX_CONCURRENT_TASKS_CEILING, Math.max(1, configured));
};

export const resolveTaskMaxSteps = (goal: GoalItem): number | undefined => {
  const configured = goal.config?.recovery?.maxStepsPerRun;
  return typeof configured === 'number' && configured > 0 ? configured : undefined;
};

export const resolveOperationLeaseTimeout = (goal: GoalItem): number => {
  const configured = goal.config?.recovery?.operationLeaseTimeoutMs;
  return typeof configured === 'number' && configured > 0
    ? Math.max(configured, MIN_OPERATION_LEASE_TIMEOUT_MS)
    : DEFAULT_OPERATION_LEASE_TIMEOUT_MS;
};

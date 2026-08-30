import type { GoalItem } from '@lobechat/types';

const DEFAULT_MAX_ATTEMPTS_PER_WORK = 3;
const DEFAULT_OPERATION_LEASE_TIMEOUT_MS = 5 * 60 * 1000;
// Agent runtime refreshes the durable operation lease every third 30-second
// step-lock heartbeat. Keep the timeout above two durable heartbeat intervals
// so a transient missed write cannot reclaim a healthy operation.
export const MIN_OPERATION_LEASE_TIMEOUT_MS = 3 * 60 * 1000;

/** How many attempts one Work gets before the coordinator opens a decision gate. */
export const resolveTaskAttemptBudget = (goal: GoalItem): number => {
  const configured = goal.config?.recovery?.maxAttemptsPerTask;
  if (typeof configured === 'number') return Math.max(1, configured);
  return DEFAULT_MAX_ATTEMPTS_PER_WORK;
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

import type { GoalItem } from '@lobechat/types';

import { HETERO_DISPATCH_ERROR_HEADLINES } from '@/server/services/aiAgent/helpers/heteroErrors';

/**
 * Attempts a Task gets before the coordinator opens a decision gate, when the
 * goal does not set its own.
 *
 * Long-horizon Tasks spend attempts on more than rejected deliveries: a run that
 * outlives its lease, a dispatch that never reached the device, a review that
 * asks for one more piece of evidence. Three attempts ran out on exactly those —
 * a Task whose work was finished still stopped the whole goal on a person — so
 * the default leaves room for a few infrastructure retries plus real repair
 * rounds. A goal can still set a lower `recovery.maxAttemptsPerTask`.
 */
const DEFAULT_MAX_ATTEMPTS_PER_TASK = 8;
/**
 * Conservative on purpose: enough to stop independent Tasks queueing behind one
 * another, low enough that a goal cannot empty its budget in one fan-out before
 * anyone sees a result.
 */
const DEFAULT_MAX_CONCURRENT_TASKS = 3;
/** Turns a goal's main Agent gets when its manager policy does not set its own. */
export const DEFAULT_MANAGER_MAX_TURNS = 12;
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

/**
 * How long a Task that could not reach its device waits for the device to come
 * back before the coordinator asks a person instead. Long enough to span a
 * laptop sleeping overnight, which is how these goals usually lose the device.
 */
export const DEVICE_RECONNECT_WAIT_MS = 12 * 60 * 60 * 1000;

/**
 * Dispatch failures that only say the device is not reachable right now. A
 * reconnect is what fixes each of them — including a lost registration, which the
 * device renews itself when it connects again — so the goal waits for it instead
 * of opening a decision nobody can act on until the device is back.
 */
const DEVICE_UNAVAILABLE_CODES = [
  'DEVICE_OFFLINE',
  'DEVICE_CHANNEL_UNAVAILABLE',
  'DEVICE_NOT_FOUND',
];

/**
 * The same failure reaches `task.error` as a raw gateway code on one path and as
 * its humanized headline on another, so match both off the one map.
 */
export const isDeviceUnavailableFailure = (error?: string | null): boolean =>
  !!error &&
  DEVICE_UNAVAILABLE_CODES.some(
    (code) => error.includes(code) || error.includes(HETERO_DISPATCH_ERROR_HEADLINES[code]),
  );

/** Whether a goal's main Agent has used every turn its policy allows. */
export const managerTurnsSpent = (config: GoalItem['config']): boolean =>
  !!config?.manager &&
  (config.managerState?.turns ?? 0) >= (config.manager.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS);

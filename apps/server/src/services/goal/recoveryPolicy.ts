import {
  DEVICE_OFFLINE_RUN_STATUS,
  QUOTA_LIMITED_RUN_STATUS,
  TRANSIENT_FAILED_RUN_STATUS,
} from '@lobechat/const/goal';
import type { GoalItem, TaskItem } from '@lobechat/types';

import { HETERO_DISPATCH_ERROR_HEADLINES } from '@/server/services/aiAgent/helpers/heteroErrors';

import { classifyGoalFailure } from './failureClass';

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
/**
 * Turns a goal's main Agent gets when its manager policy does not set its own.
 * A long-horizon goal re-plans after every round of tasks and every recovery,
 * so a low cap paused goals mid-delivery with work still queued; the owner can
 * still set a tighter cap per goal.
 */
export const DEFAULT_MANAGER_MAX_TURNS = 50;
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
 * Retry schedule for a Task whose runs keep ending because its device is
 * unavailable. Such a run is not charged to the attempt budget — nothing judged
 * the work — so it needs a bound of its own: a laptop asleep overnight should
 * resume on its own, a device that never returns should reach a person within
 * about a day.
 *
 * After the Nth consecutive offline run the next retry waits
 * `min(FIRST * 2^(N-1), MAX)`: 30min, 1h, 2h, 4h, 8h, 8h — 23.5h across
 * `MAX_DEVICE_OFFLINE_RETRIES` retries. A device that reconnects earlier is
 * retried as soon as presence shows it back.
 */
export const DEVICE_OFFLINE_FIRST_RETRY_DELAY_MS = 30 * 60 * 1000;
export const DEVICE_OFFLINE_MAX_RETRY_DELAY_MS = 8 * 60 * 60 * 1000;
export const MAX_DEVICE_OFFLINE_RETRIES = 6;
/** Why the gate opens once the offline retries are spent. */
export const DEVICE_OFFLINE_GATE_REASON = 'Task device stayed offline';

/**
 * When the next retry after `offlineFailures` consecutive offline runs is due,
 * or `undefined` once every offline retry has been spent.
 */
export const nextDeviceOfflineRetryAt = (
  offlineFailures: number,
  lastFailureAt: Date,
): Date | undefined => {
  const failures = Math.max(1, offlineFailures);
  // Every failure after the first is a retry that also found the device gone.
  if (failures - 1 >= MAX_DEVICE_OFFLINE_RETRIES) return undefined;
  const delay = Math.min(
    DEVICE_OFFLINE_FIRST_RETRY_DELAY_MS * 2 ** (failures - 1),
    DEVICE_OFFLINE_MAX_RETRY_DELAY_MS,
  );
  return new Date(lastFailureAt.getTime() + delay);
};

/** Runs that ended because their device was unavailable. */
export const isDeviceOfflineRun = (run: { status: string }): boolean =>
  run.status === DEVICE_OFFLINE_RUN_STATUS;

export const countDeviceOfflineRuns = (runs: readonly { status: string }[]): number =>
  runs.filter(isDeviceOfflineRun).length;

/**
 * Offline runs since the Task's last run that reached its device, `runs` newest
 * first. The schedule restarts once a run gets through, so a device that drops
 * once a week is not held to the budget of the week before.
 */
export const countConsecutiveDeviceOfflineRuns = (runs: readonly { status: string }[]): number => {
  const firstReached = runs.findIndex((run) => !isDeviceOfflineRun(run));
  return firstReached === -1 ? runs.length : firstReached;
};

/**
 * Runs that ended on a machine problem nothing judged: the device was gone, a
 * usage limit was hit, or a transport fault lost the run. Each retries on its
 * own bounded schedule instead of spending the attempt budget.
 */
const UNCHARGED_RUN_STATUSES = new Set<string>([
  DEVICE_OFFLINE_RUN_STATUS,
  QUOTA_LIMITED_RUN_STATUS,
  TRANSIENT_FAILED_RUN_STATUS,
]);

export const isUnchargedRun = (run: { status: string }): boolean =>
  UNCHARGED_RUN_STATUSES.has(run.status);

/** Runs not charged to the Task's attempt budget (see `UNCHARGED_RUN_STATUSES`). */
export const countUnchargedRuns = (runs: readonly { status: string }[]): number =>
  runs.filter(isUnchargedRun).length;

/**
 * Consecutive runs that ended with `status`, `runs` newest first. Like the
 * offline count, the streak restarts once any other run ends, so a usage limit
 * hit once a week is not held to last week's retries.
 */
export const countConsecutiveRunsWithStatus = (
  runs: readonly { status: string }[],
  status: string,
): number => {
  const firstOther = runs.findIndex((run) => run.status !== status);
  return firstOther === -1 ? runs.length : firstOther;
};

/**
 * Attempts charged to a Task's budget: every run it produced except the
 * uncharged ones (`countUnchargedRuns`). Those retry on their own schedules.
 */
export const countChargedTaskAttempts = (
  task: Pick<TaskItem, 'totalTopics'>,
  unchargedRuns: number,
): number => Math.max(0, (task.totalTopics ?? 0) - unchargedRuns);

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

/**
 * The `task_topics.status` a run that errored ends with. Every writer of a failed
 * run goes through this, so the dispatch result and a lifecycle hook delivered
 * later agree on an uncharged run (offline device, usage limit, transport fault)
 * instead of the later one turning it back into a charged failure.
 */
export const resolveFailedRunStatus = (error?: string | null): string => {
  if (isDeviceUnavailableFailure(error)) return DEVICE_OFFLINE_RUN_STATUS;
  const failure = classifyGoalFailure(error);
  if (failure.class === 'quota') return QUOTA_LIMITED_RUN_STATUS;
  if (failure.class === 'transient') return TRANSIENT_FAILED_RUN_STATUS;
  return 'failed';
};

/**
 * What a failed run's error says about retrying it.
 *
 * - `quota_reset`: a usage window rejected the run and reports when it reopens
 *   (`resetsAt`, epoch ms). Retrying earlier fails the same way.
 * - `device_unavailable`: the run never reached its device; a reconnect fixes it.
 * - `needs_user`: credentials, permission, spend or a cancellation. Retrying
 *   cannot help until a person acts.
 * - `transient`: network, gateway 5xx or provider capacity. A later retry can work.
 * - `unknown`: nothing above matched.
 *
 * One classification for Task runs and main Agent turns, so the two lanes stop
 * disagreeing about the same error. Earlier, a Task waited a day for an offline
 * device while a planning turn on that device was re-dispatched every few seconds.
 */
export type RunFailureKind =
  'device_unavailable' | 'needs_user' | 'quota_reset' | 'transient' | 'unknown';

/** A retry after a quota reset waits this much longer, so the window has actually reopened. */
export const QUOTA_RESET_MARGIN_MS = 60_000;

export interface RunFailure {
  kind: RunFailureKind;
  /** Only on `quota_reset`: when the usage window reopens, epoch ms. */
  resetsAt?: number;
}

const NEEDS_USER_PATTERN =
  /auth|credential|api.?key|permission|approv|forbidden|unauthor|usage.?limit|session limit|quota|billing|budget|insufficient|balance|cancel|用户|授权|凭据|额度|余额/i;
const TRANSIENT_PATTERN =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|network error|socket hang up|service unavailable|bad gateway|gateway timeout|\b50[234]\b|\b429\b|too many requests|overloaded|upstream.?busy|concurrency.?limit|DEVICE_GATEWAY_ERROR|DEVICE_GATEWAY_UNREACHABLE|DEVICE_GATEWAY_RATE_LIMITED/i;
/** `ErrorCategory` values from the model-runtime taxonomy. */
const NEEDS_USER_CATEGORIES = new Set(['auth', 'config', 'quota']);
const TRANSIENT_CATEGORIES = new Set(['capacity', 'network']);

/**
 * Classify a failed run from its operation error and any stored error text.
 * The structured fields win over text; text is all a Task run that failed at
 * dispatch leaves behind.
 */
export const classifyRunFailure = (error: unknown, text = ''): RunFailure => {
  const e = (error ?? {}) as {
    body?: { code?: unknown; rateLimitInfo?: { resetsAt?: unknown; status?: unknown } };
    category?: unknown;
    message?: unknown;
    type?: unknown;
  };
  const category = typeof e.category === 'string' ? e.category : undefined;
  const info = e.body?.rateLimitInfo;
  const resetsAt = Number(info?.resetsAt) * 1000;
  // Anthropic stamps rolling-window metadata on calls it allowed too, and a later
  // unrelated failure can carry it (see `isUserQuotaRateLimit` in the Claude Code
  // adapter). Only a rejected window, or a legacy record without a status, says
  // the run was refused until that reset.
  if (
    (category === 'quota' || e.body?.code === 'rate_limit') &&
    (info?.status === undefined || info.status === 'rejected') &&
    Number.isFinite(resetsAt) &&
    resetsAt > 0
  )
    return { kind: 'quota_reset', resetsAt };
  const message = `${typeof e.type === 'string' ? e.type : ''} ${typeof e.message === 'string' ? e.message : ''} ${text}`;
  if (isDeviceUnavailableFailure(message)) return { kind: 'device_unavailable' };
  if ((category && NEEDS_USER_CATEGORIES.has(category)) || NEEDS_USER_PATTERN.test(message))
    return { kind: 'needs_user' };
  if ((category && TRANSIENT_CATEGORIES.has(category)) || TRANSIENT_PATTERN.test(message))
    return { kind: 'transient' };
  return { kind: 'unknown' };
};

/** Whether a goal's main Agent has used every turn its policy allows. */
export const managerTurnsSpent = (config: GoalItem['config']): boolean =>
  !!config?.manager &&
  (config.managerState?.turns ?? 0) >= (config.manager.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS);

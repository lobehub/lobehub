import {
  classifyRunFailure,
  nextDeviceOfflineRetryAt,
  QUOTA_RESET_MARGIN_MS,
  type RunFailure,
} from '../recoveryPolicy';

/** Consecutive charged turns that errored without a plan before the Goal pauses. */
export const MAX_FAILED_MANAGER_TURNS = 5;
const FAILED_TURN_BASE_BACKOFF_MS = 60_000;
const FAILED_TURN_MAX_BACKOFF_MS = 30 * 60_000;

export type FailedTurnDecision =
  | { action: 'pause'; failure: RunFailure; reason: string }
  | {
      action: 'retry';
      /** Whether the failed turn counts toward the manager turn budget. */
      charged: boolean;
      failure: RunFailure;
      failedTurns: number;
      offlineTurns: number;
      retryAfter: string;
    };

/**
 * What to do after a planning turn ended in an error without committing a plan.
 *
 * It follows the same classification as Task recovery (`classifyRunFailure`):
 * - A usage window that reports its reset waits for that reset. The refused
 *   turn did no work, so it is not charged.
 * - A device that is not reachable follows the Task offline schedule
 *   (30 min, doubling to 8 h, six retries). It is not charged, and the Goal
 *   pauses once the device stays away.
 * - Credentials, spend or permission pause at once, because no retry fixes them.
 * - Anything else backs off exponentially from 1 min to 30 min and is charged.
 *   `MAX_FAILED_MANAGER_TURNS` in a row pause the Goal.
 *
 * Before this, every failure re-dispatched on the next tick. That is how one Goal
 * spent its whole 100-turn budget on a session limit in 20 minutes.
 */
export const decideFailedTurn = (
  error: unknown,
  streak: { failedTurns?: number; offlineTurns?: number },
  now = Date.now(),
): FailedTurnDecision => {
  const failure = classifyRunFailure(error);
  const failedTurns = streak.failedTurns ?? 0;
  // `offlineTurns` counts turns that never reached their device back to back. Any
  // other ending reached it, so only a device failure carries the streak forward.
  const offlineTurns = failure.kind === 'device_unavailable' ? (streak.offlineTurns ?? 0) : 0;
  const message = (error as { message?: unknown } | undefined)?.message;
  const detail = typeof message === 'string' && message ? `: ${message}` : '';

  if (failure.kind === 'quota_reset' && failure.resetsAt! + QUOTA_RESET_MARGIN_MS > now)
    return {
      action: 'retry',
      charged: false,
      failedTurns,
      failure,
      offlineTurns,
      retryAfter: new Date(failure.resetsAt! + QUOTA_RESET_MARGIN_MS).toISOString(),
    };
  if (failure.kind === 'device_unavailable') {
    const retryAt = nextDeviceOfflineRetryAt(offlineTurns + 1, new Date(now));
    if (!retryAt)
      return { action: 'pause', failure, reason: `Main Agent device stayed offline${detail}` };
    return {
      action: 'retry',
      charged: false,
      failedTurns,
      failure,
      offlineTurns: offlineTurns + 1,
      retryAfter: retryAt.toISOString(),
    };
  }
  if (failure.kind === 'needs_user')
    return {
      action: 'pause',
      failure,
      reason: `Main Agent needs credentials, spend or permission fixed${detail}`,
    };
  if (failedTurns + 1 >= MAX_FAILED_MANAGER_TURNS)
    return {
      action: 'pause',
      failure,
      reason: `Main Agent failed ${failedTurns + 1} turns in a row without a plan${detail}`,
    };
  const backoff = Math.min(
    FAILED_TURN_MAX_BACKOFF_MS,
    FAILED_TURN_BASE_BACKOFF_MS * 2 ** failedTurns,
  );
  return {
    action: 'retry',
    charged: true,
    failedTurns: failedTurns + 1,
    failure,
    offlineTurns,
    retryAfter: new Date(now + backoff).toISOString(),
  };
};

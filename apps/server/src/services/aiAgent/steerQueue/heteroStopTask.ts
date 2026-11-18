import type { HeteroControlState } from '@/server/services/redis/heteroControl';

import { sendHeteroControl } from './heteroControl';

/** Command name the `lh` steer loop registers its stop handler under. */
export const HETERO_STOP_TASK_COMMAND = 'stop_task';

/**
 * How long a stop waits for the run to claim and answer it. The `lh` handler
 * itself gives Claude Code 10 s to accept; the rest covers the steer poll.
 */
export const HETERO_STOP_TASK_TIMEOUT_MS = 20_000;

/**
 * What happened to a stop request. `accepted` only means Claude Code took the
 * request: the task is stopped once its `stopped` notification lands.
 * - `unsupported`: the run's `lh` has no stop handler;
 * - `unreachable`: no poller claimed the request — the run ended, or its `lh`
 *   predates control messages;
 * - `timeout`: the run took it and never answered in time.
 */
export type HeteroStopTaskResult =
  | { status: 'accepted' }
  | { error: string; status: 'failed' }
  | { status: 'timeout' }
  | { status: 'unreachable' }
  | { status: 'unsupported' };

export const toHeteroStopTaskResult = (
  state: HeteroControlState | undefined,
): HeteroStopTaskResult => {
  switch (state?.status) {
    case 'ok': {
      return { status: 'accepted' };
    }
    case 'unsupported': {
      return { status: 'unsupported' };
    }
    case 'expired': {
      return { status: 'unreachable' };
    }
    case 'error': {
      return { error: state.error, status: 'failed' };
    }
    default: {
      return { status: 'timeout' };
    }
  }
};

/**
 * Ask a running `lh hetero exec` to stop one Claude Code background task. The
 * caller owns authorization of `operationId`.
 */
export const stopHeteroBackgroundTask = async (
  operationId: string,
  taskId: string,
  options: { pollMs?: number; timeoutMs?: number } = {},
): Promise<HeteroStopTaskResult> => {
  const { state } = await sendHeteroControl(
    operationId,
    HETERO_STOP_TASK_COMMAND,
    { taskId },
    { pollMs: options.pollMs, timeoutMs: options.timeoutMs ?? HETERO_STOP_TASK_TIMEOUT_MS },
  );
  return toHeteroStopTaskResult(state);
};

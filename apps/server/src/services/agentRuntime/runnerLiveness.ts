import { isRecord } from '@lobechat/utils/object';

/**
 * How long a device-hosted run must have been silent (no `heteroIngest` batch
 * refreshing `agent_operations.updated_at`) before a stop that finds its runner
 * gone settles it on the spot.
 *
 * Ingest travels over HTTP, not over the device's gateway socket, so a run
 * whose socket just dropped can still be reporting. A run that is reporting
 * keeps its lease fresh and is never settled here. Two minutes is well past the
 * gap between batches of a run that is producing output, and short enough that
 * a user who closed the desktop app is not left waiting on a spinner.
 */
export const RUNNER_DISCONNECT_GRACE_MS = 2 * 60_000;

/**
 * How long a device-hosted run must have been silent before the stale sweep
 * retires it because its device is offline (`runner_disconnected`).
 *
 * Far shorter than the hetero silence window (`HETERO_OPERATION_SILENCE_MS`,
 * 60 min), which has to cover a long silent tool call on a device that is
 * still connected. A device that has been offline for this long while its run
 * reported nothing has no runner left to finish it.
 */
export const RUNNER_DISCONNECTED_SILENCE_MS = 10 * 60_000;

/**
 * Gateway codes for a call that never reached a client because the device has
 * no live connection that can take it. Same codes `isDeviceUnreachableResult`
 * treats as unreachable, plus `NO_CAPABLE_CONNECTION` (the device is connected,
 * but by no client that can run the call).
 */
const UNREACHABLE_DEVICE_CODES = [
  'DEVICE_OFFLINE',
  'DEVICE_NOT_FOUND',
  'DEVICE_CHANNEL_UNAVAILABLE',
  'NO_CAPABLE_CONNECTION',
];

/** The runner's answer when it holds no process for the task (`lh connect`, older desktops). */
const NO_TASK_FOUND = /no task found/i;

interface CancelResultLike {
  error?: unknown;
  errorData?: { code?: string } | null;
  state?: unknown;
  success?: boolean;
}

/**
 * Whether a `cancelHeteroTask` call that did not confirm the exit says the
 * run's runner is gone, rather than that a live runner failed to stop it.
 *
 * Use when:
 * - A stop could not be confirmed and the caller must choose between keeping
 *   the run (a retry can still reach its process) and settling it (nothing can).
 *
 * Returns true when:
 * - The gateway refused before reaching any client (the device is offline, or
 *   no client that can run the call is connected).
 * - The runner answered that it holds no such task: it restarted (desktop app
 *   relaunch, `lh connect` daemon restart) and lost the process with it.
 */
export const isRunnerGoneCancelResult = (result: CancelResultLike): boolean => {
  const code = result.errorData?.code;
  if (code && UNREACHABLE_DEVICE_CODES.includes(code)) return true;
  if (
    !result.success &&
    typeof result.error === 'string' &&
    UNREACHABLE_DEVICE_CODES.some((candidate) => (result.error as string).includes(candidate))
  )
    return true;

  const state = result.state;
  if (!isRecord(state) || state.exited === true) return false;
  return (
    state.reason === 'not_found' ||
    (state.success === false &&
      typeof state.message === 'string' &&
      NO_TASK_FOUND.test(state.message))
  );
};

/** The device route a topic's `runningOperation` marker records for one of its runs. */
export interface RunDeviceRoute {
  deviceId: string;
  deviceUserId?: string;
  deviceWorkspaceId?: string;
}

interface RunningOperationMarkerLike {
  childOperations?: Array<{
    deviceId?: string;
    deviceUserId?: string;
    deviceWorkspaceId?: string;
    operationId?: string;
  }>;
  deviceId?: string;
  deviceUserId?: string;
  deviceWorkspaceId?: string;
  operationId?: string;
}

/**
 * The device a run is hosted on, read from the topic's `runningOperation`
 * marker (the root run, or one of its child runs). Undefined when the marker
 * belongs to another run or the run is not device-hosted.
 */
export const findRunDeviceRoute = (
  marker: RunningOperationMarkerLike | null | undefined,
  operationId: string,
): RunDeviceRoute | undefined => {
  if (!marker) return;
  const target =
    marker.operationId === operationId
      ? marker
      : marker.childOperations?.find((child) => child.operationId === operationId);
  if (!target?.deviceId) return;
  return {
    deviceId: target.deviceId,
    deviceUserId: target.deviceUserId,
    deviceWorkspaceId: target.deviceWorkspaceId,
  };
};

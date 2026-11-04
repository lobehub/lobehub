/**
 * Batch CLI updates across a workspace's devices, built on the per-device
 * `checkCliUpdate` / `restartCli` relays. Callers decide which devices the actor
 * may operate; this module decides, per device, whether to update it.
 */
import type {
  DeviceCliBatchEntry,
  DeviceCliBatchTarget,
  DeviceCliUpdateOperation,
  DeviceCliUpdateStateResult,
} from '@lobechat/types';
import pMap from 'p-map';

/** Devices contacted at once; each relay waits up to its RPC timeout. */
const BATCH_CONCURRENCY = 8;

export interface CliBatchDevice {
  deviceId: string;
  /** Holds a live `lh connect` connection. */
  live: boolean;
}

export interface CliBatchRelay {
  check: (deviceId: string) => Promise<DeviceCliUpdateStateResult>;
  restart: (target: DeviceCliBatchTarget) => Promise<DeviceCliUpdateStateResult>;
}

/** `lh connect` labels its connection `cli`, or `cli-<variant>` (e.g. `cli-dev`). */
export const isCliChannel = (channel?: string | null): boolean =>
  !!channel && (channel === 'cli' || channel.startsWith('cli-'));

/**
 * What a fresh check means for a batch update. A device that needs nothing is
 * reported before one that cannot be updated remotely, so an up-to-date
 * foreground CLI is not listed as needing manual work.
 */
export const classifyCliCheck = (
  deviceId: string,
  result: DeviceCliUpdateStateResult,
): DeviceCliBatchEntry => {
  if (result.status !== 'ok') {
    return {
      deviceId,
      message: result.message,
      outcome: result.status === 'unsupported' ? 'unsupported' : 'failed',
    };
  }
  const { state } = result;
  // A check leaves a running operation in place and clears a finished one.
  if (state.operation && state.operation.stage !== 'failed')
    return { deviceId, outcome: 'inProgress', state };
  if (!state.latestVersion) return { deviceId, outcome: 'upToDate', state };
  if (!state.supported)
    return { deviceId, message: state.unsupportedReason, outcome: 'unsupported', state };
  if (state.activeTasks > 0) return { deviceId, outcome: 'busy', state };
  return { deviceId, outcome: 'ready', state };
};

/** Check every device; nothing restarts. */
export const checkCliDevices = (
  devices: CliBatchDevice[],
  relay: CliBatchRelay,
): Promise<DeviceCliBatchEntry[]> =>
  pMap(
    devices,
    async ({ deviceId, live }): Promise<DeviceCliBatchEntry> =>
      live
        ? classifyCliCheck(deviceId, await relay.check(deviceId))
        : { deviceId, outcome: 'offline' },
    { concurrency: BATCH_CONCURRENCY },
  );

/**
 * Check each device again and restart only the ones still ready, so a device
 * that went busy or was updated since the plan is skipped rather than
 * interrupted. A restart is sent under the caller's `requestId`, which makes a
 * repeated batch a retry on the device instead of a second update.
 */
export const updateCliDevices = (
  targets: (CliBatchDevice & DeviceCliBatchTarget)[],
  relay: CliBatchRelay,
): Promise<DeviceCliBatchEntry[]> =>
  pMap(
    targets,
    async ({ deviceId, live, requestId }): Promise<DeviceCliBatchEntry> => {
      if (!live) return { deviceId, outcome: 'offline' };
      const checked = classifyCliCheck(deviceId, await relay.check(deviceId));
      const state = checked.state;
      if (checked.outcome !== 'ready' || !state?.latestVersion) return checked;

      const requested: DeviceCliUpdateOperation = {
        fromInstanceId: state.instanceId,
        id: requestId,
        kind: 'update',
        stage: 'updating',
        targetVersion: state.latestVersion,
      };
      const result = await relay.restart({ deviceId, requestId });
      if (result.status === 'ok') {
        const operation = result.state.operation ?? requested;
        // A device that was already locked answers with the operation it is
        // running; that one is someone else's, so it is not followed as ours.
        if (operation.id !== requestId)
          return { deviceId, outcome: 'inProgress', state: result.state };
        return { deviceId, operation, outcome: 'requested', state: result.state };
      }
      // The restart may have reached the device before the relay gave up, so
      // follow it until the device reconnects or the caller's wait runs out.
      if (result.status === 'unavailable')
        return {
          deviceId,
          message: result.message,
          operation: requested,
          outcome: 'requested',
          state,
        };
      return {
        deviceId,
        message: result.message,
        outcome: result.status === 'unsupported' ? 'unsupported' : 'failed',
        state,
      };
    },
    { concurrency: BATCH_CONCURRENCY },
  );

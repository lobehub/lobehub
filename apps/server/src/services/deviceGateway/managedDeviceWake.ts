import { type LobeChatDatabase } from '@lobechat/database';
import { isManagedCloudDevice } from '@lobechat/types';
import debug from 'debug';

import { managedDeviceProvider } from '@/business/server/managedDevice';
import { DeviceModel } from '@/database/models/device';

import { deviceGateway } from './index';

const log = debug('lobe-server:managed-device-wake');

/** How often a dispatch that waits for a woken managed device asks the gateway. */
export const MANAGED_DEVICE_WAKE_POLL_INTERVAL_MS = 2000;

/** How long a dispatch waits for a woken managed device before it gives up. */
export const MANAGED_DEVICE_WAKE_TIMEOUT_MS = 120_000;

/** The retry delay a `DEVICE_WAKING` tool result asks the model to wait. */
export const MANAGED_DEVICE_WAKING_RETRY_AFTER_SECONDS = 15;

/**
 * How long a tool call that reached a starting managed device waits for it
 * before answering `DEVICE_WAKING`. The model has no way to wait on its own,
 * so a short wait here saves a model step per retry.
 */
export const MANAGED_DEVICE_TOOL_CALL_WAIT_MS = 30_000;

/** The longest a wake request may hold its caller. */
export const MANAGED_DEVICE_WAKE_REQUEST_TIMEOUT_MS = 10_000;

/** Error code of a tool call that reached a managed cloud device while it starts. */
export const DEVICE_WAKING_ERROR_CODE = 'DEVICE_WAKING';

/** A managed cloud device as a run addresses it. */
export interface ManagedDeviceTarget {
  deviceId: string;
  /** Which principal pool holds the device. */
  scope: 'personal' | 'workspace';
  /** The device's workspace, set only for a workspace device (its gateway pool). */
  workspaceId?: string;
}

interface CallerScope {
  db: LobeChatDatabase;
  userId: string;
  /** The run's workspace; a personal device of the caller is still found. */
  workspaceId?: string;
}

/**
 * The managed cloud device behind `deviceId`, as the caller sees it.
 *
 * Returns `undefined` when the deployment offers no managed devices, the row
 * is not visible to the caller, or the device is an ordinary connected one.
 * A workspace row wins over a personal row with the same id, the same order
 * the dispatch paths use.
 */
export const findManagedDevice = async (
  { db, userId, workspaceId }: CallerScope,
  deviceId: string,
): Promise<ManagedDeviceTarget | undefined> => {
  if (!managedDeviceProvider.isAvailable()) return;

  try {
    const model = new DeviceModel(db, userId, workspaceId);
    const workspaceRow = workspaceId ? await model.findWorkspaceDeviceById(deviceId) : undefined;
    const row = workspaceRow ?? (await model.findPersonalByDeviceId(deviceId));
    if (!row || !isManagedCloudDevice(row)) return;

    return row.workspaceId
      ? { deviceId, scope: 'workspace', workspaceId: row.workspaceId }
      : { deviceId, scope: 'personal' };
  } catch (error) {
    log('findManagedDevice: lookup failed for deviceId=%s: %O', deviceId, error);
    return;
  }
};

/** Whether the gateway has a live connection for this managed device now. */
export const isManagedDeviceOnline = async (
  userId: string,
  target: ManagedDeviceTarget,
): Promise<boolean> => {
  const online = await deviceGateway.queryDeviceList(userId, target.workspaceId);
  return online.some((device) => device.deviceId === target.deviceId);
};

/**
 * The managed cloud devices among `candidateIds` that are offline and can be
 * woken. Feed the ids to `resolveExecutionPlan({ wakeableDeviceIds })`.
 *
 * Costs nothing when the deployment has no managed devices. When the caller
 * already knows the online set, pass it so no gateway read is made; otherwise
 * each managed candidate is checked with the gateway.
 */
export const findWakeableManagedDevices = async (
  caller: CallerScope,
  candidateIds: (string | null | undefined)[],
  onlineDeviceIds?: string[],
): Promise<ManagedDeviceTarget[]> => {
  // Without a gateway a woken device could never be reached.
  if (!managedDeviceProvider.isAvailable() || !deviceGateway.isConfigured) return [];

  const ids = [...new Set(candidateIds.filter((id): id is string => !!id))].filter(
    (id) => !onlineDeviceIds?.includes(id),
  );
  const targets = await Promise.all(
    ids.map(async (deviceId) => {
      const target = await findManagedDevice(caller, deviceId);
      if (!target) return;
      if (!onlineDeviceIds && (await isManagedDeviceOnline(caller.userId, target))) return;
      return target;
    }),
  );

  return targets.filter((target): target is ManagedDeviceTarget => !!target);
};

/**
 * Ask the provider to start a managed device. Resolves `false` instead of
 * throwing: a failed or slow wake leaves the device offline, and every caller
 * already handles an offline device. Never holds the caller longer than
 * `MANAGED_DEVICE_WAKE_REQUEST_TIMEOUT_MS`.
 */
export const wakeManagedDevice = async (
  userId: string,
  target: ManagedDeviceTarget,
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      managedDeviceProvider.wake(
        target.workspaceId ? { userId, workspaceId: target.workspaceId } : { userId },
        target.deviceId,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Wake request timed out')),
          MANAGED_DEVICE_WAKE_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
    log('wakeManagedDevice: wake accepted for deviceId=%s', target.deviceId);
    return true;
  } catch (error) {
    console.warn('[ManagedDeviceWake] Wake request failed', {
      deviceId: target.deviceId,
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export interface WaitForDeviceOnlineOptions {
  intervalMs?: number;
  isOnline: () => Promise<boolean>;
  /** Asked before each poll; `true` ends the wait early as not online. */
  shouldStop?: () => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Poll until `isOnline` answers true, `shouldStop` answers true, or the
 * timeout passes. A failed poll counts as "not online yet". Resolves `true`
 * when the device came online.
 */
export const waitForDeviceOnline = async ({
  intervalMs = MANAGED_DEVICE_WAKE_POLL_INTERVAL_MS,
  isOnline,
  shouldStop,
  timeoutMs = MANAGED_DEVICE_WAKE_TIMEOUT_MS,
}: WaitForDeviceOnlineOptions): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      if (await shouldStop?.()) return false;
      if (await isOnline()) return true;
    } catch (error) {
      log('waitForDeviceOnline: poll failed: %O', error);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
};

/**
 * Wait for a woken managed device to connect to the gateway.
 *
 * Long-running: call it only off the request path (after the response, or in
 * a background job). Resolves `'online'`, or `'timeout'` when the device did
 * not connect in time; the caller then dispatches as before and the existing
 * offline handling takes over.
 */
export const waitForManagedDeviceOnline = async (
  userId: string,
  target: ManagedDeviceTarget,
  options: Omit<WaitForDeviceOnlineOptions, 'isOnline'> = {},
): Promise<'online' | 'timeout'> => {
  const startedAt = Date.now();
  const online = await waitForDeviceOnline({
    ...options,
    isOnline: () => isManagedDeviceOnline(userId, target),
  });
  const waitedMs = Date.now() - startedAt;
  if (online) {
    log('waitForManagedDeviceOnline: deviceId=%s online after %dms', target.deviceId, waitedMs);
  } else {
    console.warn('[ManagedDeviceWake] Managed device did not come online in time', {
      deviceId: target.deviceId,
      scope: target.scope,
      userId,
      waitedMs,
      workspaceId: target.workspaceId,
    });
  }
  return online ? 'online' : 'timeout';
};

/** The structured tool result for a call that reached a managed device while it starts. */
export const buildDeviceWakingResult = (
  deviceId: string,
): {
  content: string;
  error: {
    code: typeof DEVICE_WAKING_ERROR_CODE;
    deviceId: string;
    message: string;
    retryAfterSeconds: number;
  };
  success: false;
} => {
  const message = `Device "${deviceId}" is a managed cloud device and is still starting. Nothing ran on it. Retry the same call in about ${MANAGED_DEVICE_WAKING_RETRY_AFTER_SECONDS} seconds; do not ask the user to reconnect it.`;

  return {
    content: message,
    error: {
      code: DEVICE_WAKING_ERROR_CODE,
      deviceId,
      message,
      retryAfterSeconds: MANAGED_DEVICE_WAKING_RETRY_AFTER_SECONDS,
    },
    success: false,
  };
};

const DEVICE_UNREACHABLE_CODES = [
  'DEVICE_OFFLINE',
  'DEVICE_NOT_FOUND',
  'DEVICE_CHANNEL_UNAVAILABLE',
];

/**
 * Whether a failed device call failed because the device has no live
 * connection, as opposed to the tool itself failing on the device.
 */
export const isDeviceUnreachableResult = (result: {
  error?: unknown;
  errorData?: { code?: string } | null;
  success?: boolean;
}): boolean => {
  if (result.success) return false;
  if (result.errorData?.code && DEVICE_UNREACHABLE_CODES.includes(result.errorData.code))
    return true;
  return (
    typeof result.error === 'string' &&
    DEVICE_UNREACHABLE_CODES.some((code) => (result.error as string).includes(code))
  );
};

/**
 * Handle a call that reached a managed cloud device without a live
 * connection: wake the device and wait up to `waitMs` for it.
 *
 * - `undefined`: not a managed device (or none is available); report the
 *   failure as before.
 * - `'online'`: the device is online now; the caller may retry the call once.
 * - otherwise the `DEVICE_WAKING` result to return, so the model retries.
 */
export const awaitManagedDeviceForToolCall = async (
  caller: CallerScope,
  deviceId: string,
  waitMs: number = MANAGED_DEVICE_TOOL_CALL_WAIT_MS,
): Promise<'online' | ReturnType<typeof buildDeviceWakingResult> | undefined> => {
  const target = await findManagedDevice(caller, deviceId);
  if (!target) return;
  if (await isManagedDeviceOnline(caller.userId, target)) return 'online';

  await wakeManagedDevice(caller.userId, target);
  if (waitMs > 0) {
    const online = await waitForDeviceOnline({
      isOnline: () => isManagedDeviceOnline(caller.userId, target),
      timeoutMs: waitMs,
    });
    if (online) return 'online';
  }
  return buildDeviceWakingResult(deviceId);
};

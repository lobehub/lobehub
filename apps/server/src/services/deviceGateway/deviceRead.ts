/**
 * Shared relay for the best-effort granular device reads (git, quota).
 */
import debug from 'debug';

import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/**
 * Generic helper for granular device read RPCs (git branch / PR /
 * working-tree / ahead-behind / Claude quota). Returns `undefined` when the
 * gateway is unconfigured, the device is offline, or the call fails —
 * callers treat that as "unknown".
 */
export async function invokeDeviceRead<T>(
  getClient: DeviceClientGetter,
  method: string,
  params: { deviceId: string; timeout?: number; userId: string; workspaceId?: string },
  rpcParams: Record<string, unknown>,
): Promise<T | undefined> {
  const { userId, deviceId, timeout = 15_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<T>(
      { deviceId, timeout, userId, workspaceId },
      { method, params: rpcParams },
    );

    if (!result.success || result.data === undefined) {
      log('%s: failed for deviceId=%s — %s', method, deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('%s: error for deviceId=%s — %O', method, deviceId, error);
    return undefined;
  }
}

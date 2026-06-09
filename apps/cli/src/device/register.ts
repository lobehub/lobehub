import os from 'node:os';

import type { DeviceIdentity } from '@lobechat/device-identity';
import { deriveDeviceId } from '@lobechat/device-identity';

import { createLambdaClient } from '../api/client';

/**
 * Resolve a stable device identity. An explicit `--device-id` wins (lets a user
 * pin a VM to a fixed identity); otherwise derive from the machine id so the
 * same machine + user maps to one device across reconnects. Returns undefined
 * when neither an explicit id nor a userId is available.
 */
export function resolveDeviceIdentity(
  userId: string | undefined,
  explicitDeviceId?: string,
): DeviceIdentity | undefined {
  if (explicitDeviceId) return { deviceId: explicitDeviceId, identitySource: 'fallback' };
  if (userId) return deriveDeviceId(userId);
  return undefined;
}

/**
 * Register this device in the server registry. Shared by `lh login` (so the
 * device row exists right after auth) and `lh connect` (so the row exists
 * before the WS opens). Best-effort by contract: callers should wrap this in a
 * try/catch and treat any failure as non-fatal.
 */
export async function registerDevice(
  auth: { serverUrl: string; token: string; tokenType: 'apiKey' | 'jwt' | 'serviceToken' },
  identity: DeviceIdentity,
): Promise<void> {
  const trpc = createLambdaClient(auth);
  await trpc.device.register.mutate({
    deviceId: identity.deviceId,
    hostname: os.hostname(),
    identitySource: identity.identitySource,
    platform: process.platform,
  });
}

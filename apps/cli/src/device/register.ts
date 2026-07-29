import os from 'node:os';

import type { DeviceIdentity } from '@lobechat/device-identity';
import { deriveDeviceId, deriveScopedFallbackId } from '@lobechat/device-identity';

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

type Auth = { serverUrl: string; token: string; tokenType: 'apiKey' | 'jwt' | 'serviceToken' };

/**
 * Identity for a WORKSPACE device: derived from the workspaceId (namespaced) so
 * the same physical machine enrolled into a workspace is a distinct device from
 * its personal identity, and stable across reconnects.
 *
 * `fallbackSeed` (a stable per-install id, e.g. `loadOrCreateConnectionId()`)
 * keeps the derivation stable on machines where the OS machine id is
 * unreadable — enroll and restore re-derive this identity and must agree. The
 * seed is namespaced per workspace principal, never used raw.
 */
export function resolveWorkspaceDeviceIdentity(
  workspaceId: string,
  explicitDeviceId?: string,
  fallbackSeed?: string,
): DeviceIdentity {
  if (explicitDeviceId) return { deviceId: explicitDeviceId, identitySource: 'fallback' };
  return deriveDeviceId(`workspace:${workspaceId}`, {
    fallbackId: fallbackSeed
      ? deriveScopedFallbackId(fallbackSeed, `workspace:${workspaceId}`)
      : undefined,
  });
}

/**
 * Mint a workspace-device connect token (owner-only on the server). The returned
 * token carries the `workspace_id` claim the gateway routes by.
 */
export async function mintWorkspaceConnectToken(
  auth: Auth,
  workspaceId: string,
): Promise<{ token: string; workspaceId: string }> {
  const trpc = createLambdaClient(auth, workspaceId);
  return trpc.device.mintWorkspaceConnectToken.mutate();
}

/**
 * Register this machine as a device of the given workspace (member+).
 * `visibility: 'public'` enrolls it into the shared pool visible to every
 * member (`lh connect --workspace <id> --public`); omitted → the server
 * default (private, visible only to the enroller).
 */
export async function registerWorkspaceDevice(
  auth: Auth,
  identity: DeviceIdentity,
  workspaceId: string,
  visibility?: 'private' | 'public',
): Promise<void> {
  const trpc = createLambdaClient(auth, workspaceId);
  await trpc.device.registerWorkspaceDevice.mutate({
    deviceId: identity.deviceId,
    hostname: os.hostname(),
    identitySource: identity.identitySource,
    platform: process.platform,
    visibility,
  });
}

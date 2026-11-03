import { createHash, randomUUID } from 'node:crypto';

import { machineIdSync } from 'node-machine-id';

/**
 * Constant mixed into the deviceId hash. Not a secret — it only ensures the
 * hash input is namespaced to LobeHub so the same machine id used elsewhere
 * can't produce a colliding value.
 */
const SALT = 'lobehub-device-salt';

export type IdentitySource = 'fallback' | 'machine-id';

export interface DeviceIdentity {
  deviceId: string;
  identitySource: IdentitySource;
}

export interface DeriveDeviceIdOptions {
  /**
   * Reuse an existing id when the machine identifier is unavailable
   * (e.g. the desktop's previously stored Electron Store UUID, or a CLI
   * `--device-id` override). Keeps a device stable across the fallback path.
   */
  fallbackId?: string;
  /**
   * Override the raw machine-id reader. Defaults to `node-machine-id`. Exists
   * so callers in restricted environments and tests can inject a value without
   * mocking the module.
   */
  readMachineId?: () => string;
}

/**
 * Namespace a stable per-install seed (stored UUID, connection id) into a
 * `fallbackId` for a specific principal. Fallback machines (no readable
 * machine id) must still derive the SAME id for the same principal across
 * calls — probe, real enroll, and restore all re-derive — and a raw seed
 * cannot be reused across principals (a workspace fallback equal to the
 * personal deviceId would collide the two pools).
 */
export const deriveScopedFallbackId = (seedId: string, principal: string): string =>
  createHash('sha256').update(`${seedId}|${principal}|${SALT}`).digest('hex').slice(0, 32);

/**
 * Derive a stable deviceId for `(machine, user)`.
 *
 * Same machine + same user → same id (survives LobeHub reinstall, since the
 * machine id is OS-level). Same machine + different user → different id, so the
 * server can't correlate accounts on one machine. When the machine id can't be
 * read, falls back to `fallbackId` (or a fresh random UUID) and flags the
 * source so callers/UI can surface that this device may not survive a reinstall.
 */
export const deriveDeviceId = (
  userId: string,
  options: DeriveDeviceIdOptions = {},
): DeviceIdentity => {
  const readMachineId = options.readMachineId ?? (() => machineIdSync(true));

  try {
    const machineId = readMachineId();
    if (!machineId) throw new Error('empty machine id');

    // Fast sha256 is deliberate: this derives an opaque, stable device
    // identifier from a high-entropy machine UUID — it is NOT password storage.
    // A slow KDF (bcrypt/scrypt) only helps for low-entropy secrets; here the
    // input space is infeasible to brute-force, so it would add no security.
    // userId is mixed in solely for cross-account isolation (same machine +
    // different user → different deviceId), not as a hashed credential.
    const deviceId = createHash('sha256')
      .update(`${machineId}|${userId}|${SALT}`)
      .digest('hex')
      .slice(0, 32);

    return { deviceId, identitySource: 'machine-id' };
  } catch {
    return { deviceId: options.fallbackId ?? randomUUID(), identitySource: 'fallback' };
  }
};

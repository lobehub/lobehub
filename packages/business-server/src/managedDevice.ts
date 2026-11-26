import type { ManagedDevicePhase } from '@lobechat/types';

/**
 * Managed cloud devices are devices the platform creates and runs in the
 * cloud. The open-source build has none, so every default below answers as if
 * the capability does not exist. A deployment that offers managed devices
 * overrides this module through its own `@/business/server/...` mapping.
 */

/** Whose managed devices a call is about: a person, or a workspace they act in. */
export interface ManagedDeviceScope {
  userId: string;
  /** Set for a workspace device. Not set for a personal device. */
  workspaceId?: string;
}

export interface ManagedDeviceProvider {
  /**
   * Whether this deployment offers managed cloud devices at all. Async: a
   * deployment may read this from its database.
   */
  isAvailable: () => Promise<boolean>;
  /** Phases of the caller's managed devices, keyed by `devices.deviceId`. */
  listStates: (scope: ManagedDeviceScope) => Promise<Record<string, ManagedDevicePhase>>;
  /**
   * Ask a managed device to run. Resolves when the request is accepted, not
   * when the device is online. Callers watch device presence for that.
   */
  wake: (scope: ManagedDeviceScope, deviceId: string) => Promise<void>;
}

export const managedDeviceProvider: ManagedDeviceProvider = {
  isAvailable: async () => false,
  listStates: async () => ({}),
  wake: async () => {},
};

/** Credentials a managed device presents to get its device-gateway token. */
export interface ManagedDeviceTokenRequest {
  deviceId: string;
  secret: string;
}

export type ManagedDeviceTokenResult =
  /** `expiresAt` is an RFC 3339 timestamp. */
  | { expiresAt: string; status: 'issued'; token: string }
  /** The device does not exist or the secret does not match. */
  | { status: 'invalid-credentials' }
  /** This deployment does not offer managed devices. */
  | { status: 'unavailable' };

/**
 * Exchange a managed device's credentials for a short-lived connect token.
 * Sign the token with `signManagedDeviceToken` (`@/libs/trpc/utils/internalJwt`).
 * Server login verifiers reject its `purpose`. A token signed in a different
 * way can pass as a user login.
 */
export const exchangeManagedDeviceToken = async (
  _request: ManagedDeviceTokenRequest,
): Promise<ManagedDeviceTokenResult> => ({ status: 'unavailable' });

/**
 * A managed cloud device whose `devices` row was just deleted. `userId` is the
 * row's own user (for a workspace device, the member who enrolled it), not
 * necessarily the member who removed it.
 */
export interface ManagedDeviceRemoval extends ManagedDeviceScope {
  deviceId: string;
}

/**
 * Called after a user removes a managed cloud device (`removeDevice`,
 * `removeWorkspaceDevice`), so the deployment can release whatever backs the
 * device. The row is already gone when this runs. A rejection is logged and
 * does not fail the removal. It runs inside the request, so return when the
 * release is recorded, not when it completes.
 *
 * Rows deleted in other ways (a member leaves a workspace, a user or
 * workspace is deleted) do not call it. The deployment reconciles those.
 */
export const onManagedDeviceRemoved = async (_removal: ManagedDeviceRemoval): Promise<void> => {};

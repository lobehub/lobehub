/**
 * Managed cloud devices: devices the platform creates and runs in the cloud,
 * instead of machines a user connects with the desktop app or `lh connect`.
 *
 * A managed device is a normal `devices` row, so every device surface (lists,
 * pickers, bindings, the device gateway) treats it like any other device. Two
 * values identify it:
 *
 * - `devices.identitySource` is {@link MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE},
 *   and `devices.deviceId` is the id the managed device provider assigned.
 * - Its `environment_instances` row has `kind: 'cluster'`,
 *   `provider: MANAGED_CLOUD_CLUSTER_PROVIDER_V1`, `providerScope` set to the
 *   region the device runs in, and `providerResourceId` set to the same
 *   managed device id.
 *
 * `devices.deviceId` is unique only within one user's personal devices or one
 * workspace's devices, so resolve the device row of a cluster instance within
 * the environment's owner scope and with the managed identity source, never by
 * the id alone.
 */

/** `devices.identitySource` of a managed cloud device. */
export const MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE = 'managed-cloud-device';

/**
 * `purpose` claim of the token a managed cloud device connects with. Such a
 * token is only for the device gateway; every LobeHub server verifier must
 * reject it.
 */
export const MANAGED_DEVICE_JWT_PURPOSE = 'managed-device';

/** `environment_instances.provider` of a managed cloud device's cluster instance. */
export const MANAGED_CLOUD_CLUSTER_PROVIDER_V1 = 'managed-cloud-cluster-v1';

/** Lifecycle phases of a managed cloud device, as the managed device provider reports them. */
export const MANAGED_DEVICE_PHASES = [
  'pending',
  'running',
  'waking',
  'suspending',
  'suspended',
  'failed',
  'deleting',
] as const;

export type ManagedDevicePhase = (typeof MANAGED_DEVICE_PHASES)[number];

/** Whether a device row is a managed cloud device. */
export const isManagedCloudDevice = (device: { identitySource?: string | null }): boolean =>
  device.identitySource === MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE;

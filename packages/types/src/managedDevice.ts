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

/** Phases from which the provider cannot bring a managed device online. */
const UNWAKEABLE_MANAGED_DEVICE_PHASES: readonly ManagedDevicePhase[] = ['deleting', 'failed'];

/**
 * Whether a device is a managed cloud device that is not online now but that
 * a run can wake. Such a device is a valid choice in a device picker: binding
 * it makes the run wake it before dispatch. An unknown phase counts as
 * wakeable, the same as the server's wake path.
 */
export const isWakeableManagedDevice = (device: {
  identitySource?: string | null;
  managedPhase?: ManagedDevicePhase;
  online: boolean;
}): boolean =>
  !device.online &&
  isManagedCloudDevice(device) &&
  !(device.managedPhase && UNWAKEABLE_MANAGED_DEVICE_PHASES.includes(device.managedPhase));

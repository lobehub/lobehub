import type { DeviceListItem } from '@lobechat/types';
import { isManagedCloudDevice } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';

/**
 * What a managed cloud device is doing when its connection alone does not say
 * it. An offline managed device is usually asleep, not broken, so it shows its
 * provider phase instead of a bare "Offline".
 */
export type ManagedDeviceStatus = 'deleting' | 'failed' | 'sleeping' | 'starting' | 'stopping';

type ManagedStatusInput = Pick<
  DeviceListItem,
  'channels' | 'identitySource' | 'managedPhase' | 'onlineUnknown'
>;

/**
 * The phase-driven status of a managed cloud device, or `null` when the
 * ordinary presence (online / offline / checking) describes it. A live
 * connection wins over every phase except the two that end the device:
 * `failed` and `deleting`.
 */
export const getManagedDeviceStatus = (device: ManagedStatusInput): ManagedDeviceStatus | null => {
  if (!isManagedCloudDevice(device) || !device.managedPhase) return null;

  switch (device.managedPhase) {
    case 'failed': {
      return 'failed';
    }
    case 'deleting': {
      return 'deleting';
    }
  }

  // A row restored from the persisted list has unknown presence: keep the
  // "checking" state until a fresh list confirms the connection.
  if (device.onlineUnknown || (device.channels ?? []).length > 0) return null;

  switch (device.managedPhase) {
    case 'suspended': {
      return 'sleeping';
    }
    case 'suspending': {
      return 'stopping';
    }
    // `running` without a connection: the device is up and its agent has not
    // connected yet.
    case 'pending':
    case 'running':
    case 'waking': {
      return 'starting';
    }
  }
};

/** Short status label (detail page, status pill, hover panel). */
export const managedStatusLabelKey = {
  deleting: 'devices.managed.status.deleting',
  failed: 'devices.managed.status.failed',
  sleeping: 'devices.managed.status.sleeping',
  starting: 'devices.managed.status.starting',
  stopping: 'devices.managed.status.stopping',
} as const satisfies Record<ManagedDeviceStatus, string>;

/** Presence-dot color: sleeping stays calm, starting reads as in progress, failed as an error. */
export const managedStatusColor: Record<ManagedDeviceStatus, string> = {
  deleting: cssVar.colorTextQuaternary,
  failed: cssVar.colorError,
  sleeping: cssVar.colorInfo,
  starting: cssVar.colorWarning,
  stopping: cssVar.colorInfo,
};

/**
 * Color of a device's presence dot: its managed status color when it has one,
 * else green when online and grey when offline.
 */
export const presenceDotColor = (managedStatus: ManagedDeviceStatus | null, online: boolean) => {
  if (managedStatus) return managedStatusColor[managedStatus];
  return online ? cssVar.colorSuccess : cssVar.colorTextQuaternary;
};

/** Status-pill background matching {@link managedStatusColor}. */
export const managedStatusBackground: Record<ManagedDeviceStatus, string> = {
  deleting: cssVar.colorFillTertiary,
  failed: cssVar.colorErrorBg,
  sleeping: cssVar.colorInfoBg,
  starting: cssVar.colorWarningBg,
  stopping: cssVar.colorInfoBg,
};

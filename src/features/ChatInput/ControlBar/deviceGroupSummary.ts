import type { DeviceListItem } from '@lobechat/types';

import { isDevicePresenceUnknown } from '@/store/device';

export interface DeviceGroupSummary {
  /** The group's device that is the current pick, so the first level can name it. */
  activeDevice?: DeviceListItem;
  online: number;
  /**
   * A row restored from the persisted list before the server confirms presence
   * reads `online: false`, so the online count would undercount until then.
   */
  presenceUnknown: boolean;
  total: number;
}

/**
 * What the first level of the execution environment menu says about a device
 * group without opening it: how many of its machines can run now, and which
 * one (if any) is the current pick.
 */
export const summarizeDeviceGroup = (
  devices: DeviceListItem[],
  activeDeviceId?: string,
): DeviceGroupSummary => ({
  activeDevice: activeDeviceId ? devices.find((d) => d.deviceId === activeDeviceId) : undefined,
  online: devices.filter((d) => d.online).length,
  presenceUnknown: devices.some((d) => isDevicePresenceUnknown(d)),
  total: devices.length,
});

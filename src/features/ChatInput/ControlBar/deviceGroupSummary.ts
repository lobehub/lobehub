import type { DeviceListItem } from '@lobechat/types';

export interface DeviceGroupSummary {
  /** The group's device that is the current pick, so the first level can name it. */
  activeDevice?: DeviceListItem;
  online: number;
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
  total: devices.length,
});

import type { DeviceListItem } from '@lobechat/types';

import type { DeviceState } from './initialState';

const deviceList = (s: DeviceState): DeviceListItem[] => s.devices;

const getDeviceById =
  (deviceId: string | undefined) =>
  (s: DeviceState): DeviceListItem | undefined =>
    deviceId ? s.devices.find((d) => d.deviceId === deviceId) : undefined;

/** A device's user-configured default working directory (per-device fallback cwd). */
const getDeviceDefaultCwd =
  (deviceId: string | undefined) =>
  (s: DeviceState): string | undefined =>
    getDeviceById(deviceId)(s)?.defaultCwd ?? undefined;

/** A device's recent working dirs (also the cache for workspace-init / repoType). */
const getDeviceWorkingDirs = (deviceId: string | undefined) => (s: DeviceState) =>
  getDeviceById(deviceId)(s)?.workingDirs ?? [];

export const deviceSelectors = {
  deviceList,
  getDeviceById,
  getDeviceDefaultCwd,
  getDeviceWorkingDirs,
};

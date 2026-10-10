import type { DeviceListItem } from '@lobechat/types';

import { getChannelKind } from '@/features/DeviceManager/channelKind';

import type { DeviceState } from './initialState';

const deviceList = (s: DeviceState): DeviceListItem[] => s.devices;

/**
 * Whether a shell opened from the browser can run on this device.
 *
 * The PTY lives in the machine's `lh connect` process, and terminal RPCs carry
 * a `cli` channel hint that the gateway only treats as a *preference* — so a
 * row whose live connections are all desktop ones answers those RPCs with a
 * refusal. Requiring a live `cli` connection is what keeps the picker from
 * offering a target that cannot open a shell.
 *
 * Two edges: an offline row is a registry entry rather than a reachable host,
 * and a live row that reports no connections at all is a gateway that predates
 * the field — unknown, not unusable.
 */
export const canHostTerminal = (device: DeviceListItem): boolean => {
  if (!device.online) return false;
  const channels = device.channels ?? [];
  if (channels.length === 0) return true;
  return channels.some((channel) => getChannelKind(channel.channel) === 'cli');
};

/**
 * Whether any device can host a terminal.
 *
 * A boolean, not the filtered list: zustand compares selector results with
 * `Object.is`, and a fresh array on every call would re-render the panel on
 * every unrelated store write.
 */
const hasTerminalTarget = (s: DeviceState): boolean => s.devices.some(canHostTerminal);

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
  hasTerminalTarget,
};

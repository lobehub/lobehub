import type { DeviceListItem, DeviceMetricSeries } from '@lobechat/types';

import { getChannelKind } from '@/features/DeviceManager/channelKind';

import type { DeviceState } from './initialState';
import {
  DEVICE_LIST_KEY,
  deviceMetricSeriesKey,
  type DeviceMetricSeriesParams,
} from './projection';

const EMPTY_DEVICES: DeviceListItem[] = [];

const deviceList = (s: DeviceState): DeviceListItem[] =>
  s.deviceListMap[DEVICE_LIST_KEY] ?? EMPTY_DEVICES;

/** The list is on screen — from the persisted copy or the server. */
const isDeviceListLoaded = (s: DeviceState): boolean =>
  s.deviceListMap[DEVICE_LIST_KEY] !== undefined;

/**
 * The list was confirmed by the server this session. A persisted copy holds
 * stale `workingDirs` and unknown presence, so writes that merge into a device
 * row wait for this.
 */
const isDeviceListConfirmed = (s: DeviceState): boolean =>
  s.deviceListReplica.entries[DEVICE_LIST_KEY]?.source === 'server';

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
const hasTerminalTarget = (s: DeviceState): boolean => deviceList(s).some(canHostTerminal);

const getDeviceById =
  (deviceId: string | undefined) =>
  (s: DeviceState): DeviceListItem | undefined =>
    deviceId ? deviceList(s).find((d) => d.deviceId === deviceId) : undefined;

/** A device's user-configured default working directory (per-device fallback cwd). */
const getDeviceDefaultCwd =
  (deviceId: string | undefined) =>
  (s: DeviceState): string | undefined =>
    getDeviceById(deviceId)(s)?.defaultCwd ?? undefined;

/** A device's recent working dirs (also the cache for workspace-init / repoType). */
const getDeviceWorkingDirs = (deviceId: string | undefined) => (s: DeviceState) =>
  getDeviceById(deviceId)(s)?.workingDirs ?? [];

/** A device's health series, or `undefined` until storage or the server answers. */
const getMetricSeries =
  (params: DeviceMetricSeriesParams) =>
  (s: DeviceState): DeviceMetricSeries | undefined =>
    s.deviceMetricSeriesMap[deviceMetricSeriesKey(params)];

export const deviceSelectors = {
  deviceList,
  getDeviceById,
  getDeviceDefaultCwd,
  getDeviceWorkingDirs,
  getMetricSeries,
  hasTerminalTarget,
  isDeviceListConfirmed,
  isDeviceListLoaded,
};

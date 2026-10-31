import type { DeviceListItem, DeviceMetricSeries, DeviceScope } from '@lobechat/types';

import { AppLocalStorage } from '@/libs/replica';
import { defineReplica, REPLICA_INDEX_KEY, type ReplicaStorage } from '@/libs/replica';

/** The store reads every device of the active scope, so the list has one entry. */
export const DEVICE_LIST_KEY = 'all';

export type DeviceListParams = Record<string, never>;

/** Upper bound on persisted device rows — the snapshot must stay a small shell. */
export const MAX_PERSISTED_DEVICES = 50;

/**
 * A persisted device row keeps what the UI needs to name the device and
 * resolve its working directory (name, platform, `defaultCwd`, `workingDirs`).
 * Presence is a live gateway fact, so it never reaches storage: `online` is
 * stored as `false`, the live `channels` are dropped, and `onlineUnknown` marks
 * the row until the next `listDevices` replaces it.
 */
export const toPersistedDevice = (device: DeviceListItem): DeviceListItem => ({
  ...device,
  channels: [],
  online: false,
  onlineUnknown: true,
});

/**
 * localStorage, with the device rows reshaped by {@link toPersistedDevice} on
 * write. Memory keeps the confirmed presence; only what survives a reload is
 * narrowed. The engine's own index row passes through untouched.
 */
const createDeviceListStorage = (namespace: string): ReplicaStorage<DeviceListItem[]> => {
  const storage = new AppLocalStorage<DeviceListItem[]>({ namespace });

  return {
    get: storage.get,
    getStrict: storage.getStrict,
    remove: storage.remove,
    set: (key, row) =>
      storage.set(
        key,
        key.queryKey === REPLICA_INDEX_KEY
          ? row
          : { ...row, data: row.data.slice(0, MAX_PERSISTED_DEVICES).map(toPersistedDevice) },
      ),
  };
};

/**
 * Every device of the active scope (`deviceListMap.all`). Persisted per user +
 * workspace so a reload names the bound device and resolves its cwd on first
 * paint; presence stays unknown until the server answers.
 */
export const deviceListResource = defineReplica<DeviceListParams, DeviceListItem[]>({
  key: () => DEVICE_LIST_KEY,
  name: 'deviceList',
  storage: createDeviceListStorage('replica:deviceList:v1'),
  version: 1,
});

export interface DeviceMetricSeriesParams {
  deviceId: string;
  /** The list row's scope: a deviceId enrolled both personally and in the workspace reads the row it was listed as. */
  scope?: DeviceScope;
}

export const deviceMetricSeriesKey = ({ deviceId, scope }: DeviceMetricSeriesParams) =>
  `${scope ?? 'default'}:${deviceId}`;

/**
 * A device's CPU / memory / load over the recent window, one entry per device.
 * Persisted so the device page and hover panel chart history on first paint;
 * the newest reading of a persisted copy is old by however long the app was
 * closed, so "current load" readers judge it by wall-clock age, never by
 * presence of data. Bounded: a device grid persists one row per device seen.
 */
export const deviceMetricSeriesResource = defineReplica<
  DeviceMetricSeriesParams,
  DeviceMetricSeries
>({
  key: deviceMetricSeriesKey,
  name: 'deviceMetricSeries',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});

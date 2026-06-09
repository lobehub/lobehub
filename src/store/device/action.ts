import type { DeviceListItem, WorkingDirEntry } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';
import { type StoreSetter } from '@/store/types';

import { nextWorkingDirs, removeWorkingDir, WORKING_DIRS_MAX } from './deviceCwd';
import { type DeviceStore } from './store';

const FETCH_DEVICES_KEY = 'device:listDevices';

type Setter = StoreSetter<DeviceStore>;

export const deviceSlice = (set: Setter, get: () => DeviceStore, _api?: unknown) =>
  new DeviceActionImpl(set, get, _api);

export class DeviceActionImpl {
  readonly #get: () => DeviceStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DeviceStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * Persist a working-directory choice to a device (`defaultCwd` + `workingDirs`)
   * with an optimistic store update, then revalidate from the server. Pass
   * `setDefault: false` to record the dir in the recent list without repointing
   * the device's default cwd.
   */
  updateDeviceCwd = async (
    deviceId: string,
    entry: WorkingDirEntry,
    options: { setDefault?: boolean } = {},
  ): Promise<void> => {
    const trimmed = entry.path.trim();
    if (!trimmed) return;
    const setDefault = options.setDefault ?? true;

    const device = this.#get().devices.find((d) => d.deviceId === deviceId);
    const updatedDirs = nextWorkingDirs(entry, device?.workingDirs ?? []);

    // Optimistic: patch the touched device in place. Spreading widens the item
    // out of the listDevices union, so re-assert the element type.
    this.#set(
      {
        devices: this.#get().devices.map((d) =>
          d.deviceId === deviceId
            ? { ...d, ...(setDefault ? { defaultCwd: trimmed } : {}), workingDirs: updatedDirs }
            : d,
        ) as DeviceListItem[],
      },
      false,
      'updateDeviceCwd',
    );

    try {
      await deviceService.updateDevice({
        deviceId,
        ...(setDefault ? { defaultCwd: trimmed } : {}),
        workingDirs: updatedDirs,
      });
    } finally {
      // Re-fetch the truth (self-corrects a failed optimistic write).
      await mutate(FETCH_DEVICES_KEY);
    }
  };

  /**
   * Merge legacy recent dirs (read from localStorage by the caller — the store
   * stays out of feature-layer storage) into a device's `device.workingDirs`.
   * Existing device entries win on conflict. Rejects if the persist fails so the
   * caller can keep localStorage for a retry; resolves once safely merged.
   */
  migrateLocalRecentsToDevice = async (
    deviceId: string,
    legacyEntries: WorkingDirEntry[],
  ): Promise<void> => {
    if (legacyEntries.length === 0) return;

    const device = this.#get().devices.find((d) => d.deviceId === deviceId);
    const existing = device?.workingDirs ?? [];
    const existingPaths = new Set(existing.map((d) => d.path));
    const merged = [...existing, ...legacyEntries.filter((d) => !existingPaths.has(d.path))].slice(
      0,
      WORKING_DIRS_MAX,
    );

    this.#set(
      {
        devices: this.#get().devices.map((d) =>
          d.deviceId === deviceId ? { ...d, workingDirs: merged } : d,
        ) as DeviceListItem[],
      },
      false,
      'migrateLocalRecents',
    );

    try {
      await deviceService.updateDevice({ deviceId, workingDirs: merged });
    } finally {
      await mutate(FETCH_DEVICES_KEY);
    }
  };

  /** Remove a path from a device's `workingDirs` recent list (optimistic). */
  removeDeviceWorkingDir = async (deviceId: string, path: string): Promise<void> => {
    const device = this.#get().devices.find((d) => d.deviceId === deviceId);
    if (!device) return;
    const updated = removeWorkingDir(path, device.workingDirs ?? []);

    this.#set(
      {
        devices: this.#get().devices.map((d) =>
          d.deviceId === deviceId ? { ...d, workingDirs: updated } : d,
        ) as DeviceListItem[],
      },
      false,
      'removeDeviceWorkingDir',
    );

    try {
      await deviceService.updateDevice({ deviceId, workingDirs: updated });
    } finally {
      await mutate(FETCH_DEVICES_KEY);
    }
  };

  useFetchDevices = (enabled = true): SWRResponse<DeviceListItem[]> =>
    useClientDataSWR<DeviceListItem[]>(
      enabled ? FETCH_DEVICES_KEY : null,
      () => deviceService.listDevices(),
      {
        fallbackData: [],
        onSuccess: (data) => {
          this.#set({ devices: data, isDevicesInit: true }, false, 'fetchDevices');
        },
      },
    );
}

export type DeviceAction = Pick<DeviceActionImpl, keyof DeviceActionImpl>;

import type { DeviceListItem, WorkingDirEntry, WorkingDirRepoType } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { refreshDeviceList } from '@/features/DeviceManager/const';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';
import { type StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  nextWorkingDirs,
  removeWorkingDir,
  setWorkingDirRepoType,
  WORKING_DIRS_MAX,
} from './deviceCwd';
import { type DeviceStore } from './store';

type Setter = StoreSetter<DeviceStore>;

/** How long a repo-type correction that failed transiently waits before it may be re-sent. */
const REPO_TYPE_SYNC_RETRY_MS = 60 * 1000;

/**
 * Revalidate both device-list caches: this store's own key and the canonical
 * workspace-scoped `useDeviceList` entry, which task controls read.
 */
const revalidateDeviceLists = () =>
  Promise.all([mutate(deviceKeys.listDevices()), refreshDeviceList()]);

type UpdateDeviceInput = Parameters<typeof deviceService.updateDevice>[0];

/**
 * Persist user-editable fields, routed by the device's own scope. Workspace
 * devices live under `workspace_id`, so the userId-scoped personal mutation
 * would match no row and the write would be silently dropped.
 */
const persistDevice = (device: DeviceListItem | undefined, input: UpdateDeviceInput) =>
  device?.scope === 'workspace'
    ? deviceService.updateWorkspaceDevice(input)
    : deviceService.updateDevice(input);

export const deviceSlice = (set: Setter, get: () => DeviceStore, _api?: unknown) =>
  new DeviceActionImpl(set, get, _api);

export class DeviceActionImpl {
  readonly #get: () => DeviceStore;
  readonly #set: Setter;
  /** `syncWorkingDirRepoType` targets that may not be sent again before the given time. */
  readonly #repoTypeSyncBlockedUntil = new Map<string, number>();

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
      if (device?.scope === 'workspace') {
        // Members share this list: add the one entry server-side instead of
        // replacing the list with this client's possibly stale snapshot.
        await deviceService.addWorkspaceDeviceWorkingDir({
          deviceId,
          entry: { ...entry, path: trimmed },
        });
        if (setDefault)
          await deviceService.updateWorkspaceDevice({ defaultCwd: trimmed, deviceId });
      } else {
        await deviceService.updateDevice({
          deviceId,
          ...(setDefault ? { defaultCwd: trimmed } : {}),
          workingDirs: updatedDirs,
        });
      }
    } finally {
      // Re-fetch the truth (self-corrects a failed optimistic write).
      await revalidateDeviceLists();
    }
  };

  /** Clear a device's default cwd without removing it from the recent directory list. */
  clearDeviceDefaultCwd = async (deviceId: string): Promise<void> => {
    const device = this.#get().devices.find((d) => d.deviceId === deviceId);
    if (!device?.defaultCwd) return;

    const previousDefaultCwd = device.defaultCwd;

    this.#set(
      {
        devices: this.#get().devices.map((d) =>
          d.deviceId === deviceId ? { ...d, defaultCwd: null } : d,
        ) as DeviceListItem[],
      },
      false,
      'clearDeviceDefaultCwd',
    );

    try {
      await persistDevice(device, { defaultCwd: null, deviceId });
    } catch (error) {
      // Preserve the prior default if the optimistic write cannot be persisted.
      this.#set(
        {
          devices: this.#get().devices.map((d) =>
            d.deviceId === deviceId ? { ...d, defaultCwd: previousDefaultCwd } : d,
          ) as DeviceListItem[],
        },
        false,
        'clearDeviceDefaultCwd/error',
      );
      throw error;
    } finally {
      await revalidateDeviceLists();
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
      await persistDevice(device, { deviceId, workingDirs: merged });
    } finally {
      await revalidateDeviceLists();
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
      await (device.scope === 'workspace'
        ? deviceService.removeWorkspaceDeviceWorkingDir({ deviceId, path })
        : deviceService.updateDevice({ deviceId, workingDirs: updated }));
    } finally {
      await revalidateDeviceLists();
    }
  };

  /**
   * Correct a device working dir's cached `repoType` in place after a live probe
   * disagreed with it — e.g. a folder registered while still empty and cloned
   * into afterwards. Neither reorders nor adds entries; a no-op when nothing
   * changes. A failed write must not loop with the revalidation that restores
   * the stale value, so its target is held back: for the rest of the session
   * when the server refused it (a viewer cannot edit a shared device), for
   * `REPO_TYPE_SYNC_RETRY_MS` after a transient failure. A write that succeeds
   * holds nothing back, so a later legitimate change to the same value is sent.
   *
   * Resolves, when the correction was held back, the time it may be sent again
   * (`Infinity` for never) so a caller can schedule the retry; otherwise
   * `undefined`.
   */
  syncWorkingDirRepoType = async (
    deviceId: string,
    path: string,
    repoType: WorkingDirRepoType | undefined,
  ): Promise<number | undefined> => {
    const device = this.#get().devices.find((d) => d.deviceId === deviceId);
    if (!device) return;
    const updated = setWorkingDirRepoType(device.workingDirs ?? [], path, repoType);
    if (!updated) return;

    const syncKey = JSON.stringify([deviceId, path, repoType ?? null]);
    const blockedUntil = this.#repoTypeSyncBlockedUntil.get(syncKey) ?? 0;
    if (blockedUntil > Date.now()) return blockedUntil;
    // Held back while in flight too, so a re-render cannot send it twice.
    this.#repoTypeSyncBlockedUntil.set(syncKey, Number.POSITIVE_INFINITY);

    this.#set(
      {
        devices: this.#get().devices.map((d) =>
          d.deviceId === deviceId ? { ...d, workingDirs: updated } : d,
        ) as DeviceListItem[],
      },
      false,
      'syncWorkingDirRepoType',
    );

    try {
      await (device.scope === 'workspace'
        ? deviceService.setWorkspaceDeviceWorkingDirRepoType({ deviceId, path, repoType })
        : deviceService.updateDevice({ deviceId, workingDirs: updated }));
      this.#repoTypeSyncBlockedUntil.delete(syncKey);
    } catch (error) {
      const refused = isTrpcErrorCode(error, 'FORBIDDEN') || isTrpcErrorCode(error, 'UNAUTHORIZED');
      this.#repoTypeSyncBlockedUntil.set(
        syncKey,
        refused ? Number.POSITIVE_INFINITY : Date.now() + REPO_TYPE_SYNC_RETRY_MS,
      );
      throw error;
    } finally {
      await revalidateDeviceLists();
    }
  };

  useFetchDevices = (enabled = false): SWRResponse<DeviceListItem[]> =>
    useClientDataSWR<DeviceListItem[]>(
      enabled ? deviceKeys.listDevices() : null,
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

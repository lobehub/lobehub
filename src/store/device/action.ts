import type { DeviceListItem, DeviceMetricSeries, WorkingDirEntry } from '@lobechat/types';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { deviceService } from '@/services/device';
import { type StoreSetter } from '@/store/types';

import { nextWorkingDirs, removeWorkingDir, WORKING_DIRS_MAX } from './deviceCwd';
import {
  DEVICE_LIST_KEY,
  type DeviceListParams,
  deviceListResource,
  type DeviceMetricSeriesParams,
  deviceMetricSeriesResource,
} from './projection';
import { deviceSelectors } from './selectors';
import { type DeviceStore } from './store';

type Setter = StoreSetter<DeviceStore>;

const LIST_PARAMS = {} as DeviceListParams;

/**
 * Pickers, chips and guards across a page mount the list at different times.
 * The app's SWR default (no dedupe) would let each late mount re-request it;
 * inside this window they join the last request instead. Explicit refreshes,
 * post-write revalidation and polling still go out.
 */
const DEVICE_LIST_DEDUPING_INTERVAL = 10_000;

/** Devices upload every 5 minutes; polling faster only re-reads the same samples. */
const METRIC_SERIES_REFRESH_INTERVAL = 5 * 60_000;
/** The chip, the hover panel and the detail page mount one device's series together; let them share one request. */
const METRIC_SERIES_DEDUPING_INTERVAL = 30_000;

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
  readonly #list;
  readonly #metricSeries;

  constructor(set: Setter, get: () => DeviceStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(deviceListResource, {
      actionPrefix: 'device/list',
      fetcher: () => deviceService.listDevices(),
      get,
      set,
      stateKey: 'deviceListReplica',
      view: recordLens<DeviceStore, DeviceListItem[]>('deviceListMap'),
    });
    this.#metricSeries = createReplicaSlice(deviceMetricSeriesResource, {
      actionPrefix: 'device/metricSeries',
      fetcher: ({ deviceId, scope }) => deviceService.getMetricSeries(deviceId, scope),
      get,
      set,
      stateKey: 'deviceMetricSeriesReplica',
      view: recordLens<DeviceStore, DeviceMetricSeries>('deviceMetricSeriesMap'),
    });
  }

  #devices = (): DeviceListItem[] => deviceSelectors.deviceList(this.#get());

  /** Patch one device row optimistically; rolls back if `serverCall` rejects. */
  #patchDevice = <T>(
    deviceId: string,
    patch: (device: DeviceListItem) => DeviceListItem,
    serverCall: () => Promise<T>,
  ): Promise<T> =>
    this.#list.optimistic(
      DEVICE_LIST_KEY,
      (devices) => devices.map((d) => (d.deviceId === deviceId ? patch(d) : d)),
      serverCall,
    );

  /** Re-fetch the truth (server-normalized fields, other tabs' writes). */
  #revalidateDeviceLists = () => this.#list.revalidate(DEVICE_LIST_KEY);

  /**
   * Re-run the device list request of every mounted reader. Resolves once the
   * response is folded into the store; read the rows with `deviceSelectors`.
   */
  refreshDevices = (): Promise<unknown> => this.#list.revalidate(DEVICE_LIST_KEY);

  /**
   * Seed the persisted device list before the route commits, so the bound
   * device's name and cwd paint on the first frame instead of after the
   * mount-time hydrate. Call from a route loader, bounded by a timeout.
   */
  preHydrateDeviceList = async (): Promise<boolean> => {
    const scope = deviceListResource.scope.get();
    // The slot may still hold the previous identity's rows; drop them first.
    this.#list.ensureScope(scope);
    return this.#list.hydrate(LIST_PARAMS, scope);
  };

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

    const device = this.#devices().find((d) => d.deviceId === deviceId);
    const updatedDirs = nextWorkingDirs(entry, device?.workingDirs ?? []);

    try {
      // Spreading widens the item out of the listDevices union, so re-assert it.
      await this.#patchDevice(
        deviceId,
        (d) =>
          ({
            ...d,
            ...(setDefault ? { defaultCwd: trimmed } : {}),
            workingDirs: updatedDirs,
          }) as DeviceListItem,
        async () => {
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
        },
      );
    } finally {
      // Re-fetch the truth (server-normalized fields, other tabs' writes).
      await this.#revalidateDeviceLists();
    }
  };

  /** Clear a device's default cwd without removing it from the recent directory list. */
  clearDeviceDefaultCwd = async (deviceId: string): Promise<void> => {
    const device = this.#devices().find((d) => d.deviceId === deviceId);
    if (!device?.defaultCwd) return;

    try {
      // A failed write rolls back to the prior default.
      await this.#patchDevice(
        deviceId,
        (d) => ({ ...d, defaultCwd: null }) as DeviceListItem,
        () => persistDevice(device, { defaultCwd: null, deviceId }),
      );
    } finally {
      await this.#revalidateDeviceLists();
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

    const device = this.#devices().find((d) => d.deviceId === deviceId);
    const existing = device?.workingDirs ?? [];
    const existingPaths = new Set(existing.map((d) => d.path));
    const merged = [...existing, ...legacyEntries.filter((d) => !existingPaths.has(d.path))].slice(
      0,
      WORKING_DIRS_MAX,
    );

    try {
      await this.#patchDevice(
        deviceId,
        (d) => ({ ...d, workingDirs: merged }) as DeviceListItem,
        () => persistDevice(device, { deviceId, workingDirs: merged }),
      );
    } finally {
      await this.#revalidateDeviceLists();
    }
  };

  /** Remove a path from a device's `workingDirs` recent list (optimistic). */
  removeDeviceWorkingDir = async (deviceId: string, path: string): Promise<void> => {
    const device = this.#devices().find((d) => d.deviceId === deviceId);
    if (!device) return;
    const updated = removeWorkingDir(path, device.workingDirs ?? []);

    try {
      await this.#patchDevice(
        deviceId,
        (d) => ({ ...d, workingDirs: updated }) as DeviceListItem,
        () =>
          device.scope === 'workspace'
            ? deviceService.removeWorkspaceDeviceWorkingDir({ deviceId, path })
            : deviceService.updateDevice({ deviceId, workingDirs: updated }),
      );
    } finally {
      await this.#revalidateDeviceLists();
    }
  };

  /**
   * Fetch orchestration only; read the rows with `deviceSelectors.deviceList`.
   * The persisted copy paints first (presence unknown), then the server
   * confirms it in the background. A surface that tracks presence live passes
   * its own `refreshInterval`.
   */
  useFetchDevices = (enabled = false, schedule?: { refreshInterval?: number }): ReplicaSyncResult =>
    this.#list.useSync(LIST_PARAMS, {
      dedupingInterval: DEVICE_LIST_DEDUPING_INTERVAL,
      enabled,
      ...schedule,
    });

  /**
   * Fetch orchestration for one device's health series; read it with
   * `deviceSelectors.getMetricSeries`. `enabled: false` (an off-screen card,
   * an offline device) stops fetching and keeps what the store holds.
   */
  useFetchDeviceMetricSeries = (
    params: DeviceMetricSeriesParams,
    enabled = true,
  ): ReplicaSyncResult =>
    this.#metricSeries.useSync(params, {
      dedupingInterval: METRIC_SERIES_DEDUPING_INTERVAL,
      enabled,
      refreshInterval: METRIC_SERIES_REFRESH_INTERVAL,
    });
}

export type DeviceAction = Pick<DeviceActionImpl, keyof DeviceActionImpl>;

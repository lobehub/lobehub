import type { DeviceListeningPortsResult } from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { deviceService } from '@/services/device';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import {
  type DeviceListeningPortsParams,
  deviceListeningPortsResource,
  type DeviceTunnelLink,
  deviceTunnelsKey,
  type DeviceTunnelsParams,
  deviceTunnelsResource,
  toPersistedListeningPorts,
  toStoredTunnelLink,
} from './projection';

export interface DeviceTunnelStoreState {
  /** `deviceListeningPortsKey(params)` → ports at the last probe. */
  deviceListeningPortsMap: Record<string, DeviceListeningPortsResult>;
  deviceListeningPortsReplica: ReplicaState<DeviceListeningPortsResult>;
  /** `deviceTunnelsKey(params)` → the device's tunnel links. */
  deviceTunnelsMap: Record<string, DeviceTunnelLink[]>;
  deviceTunnelsReplica: ReplicaState<DeviceTunnelLink[]>;
}

export const initialDeviceTunnelState: DeviceTunnelStoreState = {
  deviceListeningPortsMap: {},
  deviceListeningPortsReplica: createReplicaState(),
  deviceTunnelsMap: {},
  deviceTunnelsReplica: createReplicaState(),
};

const createSlices = (
  set: (partial: Partial<DeviceTunnelStore>, replace?: false, action?: any) => void,
  get: () => DeviceTunnelStore,
) => ({
  listeningPorts: createReplicaSlice(deviceListeningPortsResource, {
    actionPrefix: 'deviceTunnel/listeningPorts',
    // `null` is the device failing to answer (offline, a client that predates
    // detection): an unknown result, not "nothing listens". Reject it so the
    // persisted ports stay in place — still unconfirmed — instead of being
    // overwritten by an empty answer.
    fetcher: async ({ cwd, deviceId }: DeviceListeningPortsParams) => {
      const result = await deviceService.listListeningPorts({ cwd, deviceId });
      if (!result) throw new Error('Unable to detect listening ports');
      return result;
    },
    get,
    set,
    stateKey: 'deviceListeningPortsReplica',
    toPersisted: toPersistedListeningPorts,
    view: recordLens<DeviceTunnelStore, DeviceListeningPortsResult>('deviceListeningPortsMap'),
  }),
  tunnels: createReplicaSlice(deviceTunnelsResource, {
    actionPrefix: 'deviceTunnel/tunnels',
    fetcher: async ({ deviceId }: DeviceTunnelsParams) =>
      (await deviceService.listTunnels({ deviceId })).map(toStoredTunnelLink),
    get,
    set,
    stateKey: 'deviceTunnelsReplica',
    view: recordLens<DeviceTunnelStore, DeviceTunnelLink[]>('deviceTunnelsMap'),
  }),
});

type DeviceTunnelSlices = ReturnType<typeof createSlices>;

export interface DeviceTunnelStore extends DeviceTunnelStoreState {
  /**
   * Fold a link the server just created into the device's list (memory and
   * storage; clean fields only, never the create response's `openUrl`), and
   * re-read the list in the background — opening the link must not wait on it.
   */
  addTunnelLink: (link: DeviceTunnelLink) => void;
  /** Re-read a device's links now (mounted or not); a failure keeps the list. */
  refreshTunnels: (deviceId: string) => Promise<void>;
  /**
   * Drop a link the server just revoked from the device's list — memory and
   * storage, so a reload cannot paint it back — and re-read the list in the
   * background.
   */
  removeTunnelLink: (deviceId: string, slug: string) => void;
  /** @internal The replica slices; read through the hooks in `tunnelHooks.ts`. */
  slices: DeviceTunnelSlices;
}

const devtools = createDevtools('deviceTunnel');

export const useDeviceTunnelStore = createWithEqualityFn<DeviceTunnelStore>()(
  devtools((set, get) => {
    const slices = createSlices(set, get);

    const refreshTunnels = async (deviceId: string) => {
      try {
        await slices.tunnels.fetch({ deviceId }, { fresh: true });
      } catch {
        // Keep the written list; the next read repairs it.
      }
    };

    return {
      ...initialDeviceTunnelState,
      addTunnelLink: (link) => {
        const key = deviceTunnelsKey({ deviceId: link.deviceId });
        slices.tunnels.update(key, (current) => [
          ...(current ?? []).filter((item) => item.slug !== link.slug),
          toStoredTunnelLink(link),
        ]);
        void refreshTunnels(link.deviceId);
      },
      refreshTunnels,
      removeTunnelLink: (deviceId, slug) => {
        const key = deviceTunnelsKey({ deviceId });
        slices.tunnels.update(key, (current) => (current ?? []).filter((l) => l.slug !== slug));
        void refreshTunnels(deviceId);
      },
      slices,
    };
  }),
  shallow,
);

expose('deviceTunnel', useDeviceTunnelStore);

export const getDeviceTunnelStoreState = () => useDeviceTunnelStore.getState();

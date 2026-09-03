import { isDesktop } from '@lobechat/const';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { electronKeys } from '@/libs/swr/keys';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

type Setter = StoreSetter<ElectronStore>;
export const gatewaySlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new ElectronGatewayActionImpl(set, get, _api);

export interface GatewayDeviceInfo {
  deviceId: string;
  hostname: string;
  platform: string;
}

export class ElectronGatewayActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, _get: () => ElectronStore, _api?: unknown) {
    void _get;
    void _api;
    this.#set = set;
  }

  connectGateway = async (): Promise<void> => {
    this.#set({ gatewayConnectionStatus: 'connecting' });
    try {
      const result = await gatewayConnectionService.connect();
      if (!result.success) {
        this.#set({ gatewayConnectionStatus: 'disconnected' });
      }
    } catch (error) {
      console.error('Gateway connect failed:', error);
      this.#set({ gatewayConnectionStatus: 'disconnected' });
    }
  };

  disconnectGateway = async (): Promise<void> => {
    try {
      await gatewayConnectionService.disconnect();
      this.#set({ gatewayConnectionStatus: 'disconnected' });
    } catch (error) {
      console.error('Gateway disconnect failed:', error);
    }
  };

  setGatewayConnectionStatus = (status: GatewayConnectionStatus): void => {
    this.#set({ gatewayConnectionStatus: status }, false, 'setGatewayConnectionStatus');
  };

  useFetchGatewayDeviceInfo = (): SWRResponse<GatewayDeviceInfo> => {
    return useSWR<GatewayDeviceInfo>(
      // Desktop-only IPC: on web there is no electronAPI, and under a
      // suspense-mode SWRConfig a rejected fetch throws into the route
      // boundary instead of staying in `error` — so never fetch off-desktop.
      isDesktop ? electronKeys.gatewayDeviceInfo() : null,
      async () => gatewayConnectionService.getDeviceInfo() as Promise<GatewayDeviceInfo>,
      {
        onSuccess: (data) => {
          this.#set({ gatewayDeviceInfo: data }, false, 'setGatewayDeviceInfo');
        },
      },
    );
  };

  useFetchGatewayStatus = (): SWRResponse<{ status: GatewayConnectionStatus }> => {
    return useSWR<{ status: GatewayConnectionStatus }>(
      isDesktop ? 'electron:getGatewayConnectionStatus' : null,
      async () => gatewayConnectionService.getConnectionStatus(),
      {
        onSuccess: (data) => {
          this.#set({ gatewayConnectionStatus: data.status }, false, 'setGatewayConnectionStatus');
        },
      },
    );
  };
}

export type ElectronGatewayAction = Pick<
  ElectronGatewayActionImpl,
  keyof ElectronGatewayActionImpl
>;

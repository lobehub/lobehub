import { isDesktop } from '@lobechat/const';
import type { GatewayConnectionState } from '@lobechat/electron-client-ipc';
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
    this.#set({ gatewayConnectionError: undefined, gatewayConnectionStatus: 'connecting' });
    try {
      const result = await gatewayConnectionService.connect();
      if (!result.success) {
        // The main process owns the outcome (and its reason); a superseded
        // attempt may already be connecting again, so take its state as is.
        this.setGatewayConnectionState(await gatewayConnectionService.getConnectionStatus());
      }
    } catch (error) {
      console.error('Gateway connect failed:', error);
      this.#set({ gatewayConnectionStatus: 'disconnected' });
    }
  };

  disconnectGateway = async (): Promise<void> => {
    try {
      await gatewayConnectionService.disconnect();
      this.#set({ gatewayConnectionError: undefined, gatewayConnectionStatus: 'disconnected' });
    } catch (error) {
      console.error('Gateway disconnect failed:', error);
    }
  };

  setGatewayConnectionState = ({ error, status }: GatewayConnectionState): void => {
    this.#set(
      { gatewayConnectionError: error, gatewayConnectionStatus: status },
      false,
      'setGatewayConnectionState',
    );
  };

  useFetchGatewayDeviceInfo = (): SWRResponse<GatewayDeviceInfo> => {
    return useSWR<GatewayDeviceInfo>(
      // Desktop-only IPC: on web there is no electronAPI, so never fetch off-desktop.
      isDesktop ? electronKeys.gatewayDeviceInfo() : null,
      async () => gatewayConnectionService.getDeviceInfo() as Promise<GatewayDeviceInfo>,
      {
        onSuccess: (data) => {
          this.#set({ gatewayDeviceInfo: data }, false, 'setGatewayDeviceInfo');
        },
      },
    );
  };

  useFetchGatewayStatus = (): SWRResponse<GatewayConnectionState> => {
    return useSWR<GatewayConnectionState>(
      isDesktop ? 'electron:getGatewayConnectionStatus' : null,
      async () => gatewayConnectionService.getConnectionStatus(),
      { onSuccess: (data) => this.setGatewayConnectionState(data) },
    );
  };
}

export type ElectronGatewayAction = Pick<
  ElectronGatewayActionImpl,
  keyof ElectronGatewayActionImpl
>;

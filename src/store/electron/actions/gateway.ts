import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

const GATEWAY_DEVICE_INFO_KEY = 'electron:getGatewayDeviceInfo';

type Setter = StoreSetter<ElectronStore>;
export const gatewaySlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new ElectronGatewayActionImpl(set, get, _api);

export interface GatewayDeviceInfo {
  description: string;
  deviceId: string;
  hostname: string;
  name: string;
  platform: string;
}

export class ElectronGatewayActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
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

  refreshGatewayDeviceInfo = async (): Promise<void> => {
    await mutate(GATEWAY_DEVICE_INFO_KEY);
  };

  setGatewayConnectionStatus = (status: GatewayConnectionStatus): void => {
    this.#set({ gatewayConnectionStatus: status }, false, 'setGatewayConnectionStatus');
  };

  updateDeviceDescription = async (description: string): Promise<void> => {
    try {
      await gatewayConnectionService.setDeviceDescription(description);
      await this.#get().refreshGatewayDeviceInfo();
    } catch (error) {
      console.error('Update device description failed:', error);
    }
  };

  updateDeviceName = async (name: string): Promise<void> => {
    try {
      await gatewayConnectionService.setDeviceName(name);
      await this.#get().refreshGatewayDeviceInfo();
    } catch (error) {
      console.error('Update device name failed:', error);
    }
  };

  useFetchGatewayDeviceInfo = (): SWRResponse<GatewayDeviceInfo> => {
    return useSWR<GatewayDeviceInfo>(
      GATEWAY_DEVICE_INFO_KEY,
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
      'electron:getGatewayConnectionStatus',
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

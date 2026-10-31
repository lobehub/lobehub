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
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#get = get;
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

  /**
   * This desktop's stable device id, for writes that pin a topic's cwd to it.
   *
   * Asked over IPC every time rather than read from `gatewayDeviceInfo`: before
   * the gateway connects, that holds the install's fallback UUID, which stops
   * naming this machine once the user-scoped identity is derived. The IPC
   * derives that identity locally — no network on the send path — and returns
   * nothing while signed out, so no pin is written rather than a stale one.
   * A differing cached id is corrected too, so "this device" comparisons agree
   * with the pins written here.
   */
  resolveGatewayDeviceId = async (): Promise<string | undefined> => {
    if (!isDesktop) return;
    try {
      const deviceId = (await gatewayConnectionService.getStableDeviceId()) ?? undefined;
      const cached = this.#get().gatewayDeviceInfo;
      if (deviceId && cached && cached.deviceId !== deviceId) {
        this.#set({ gatewayDeviceInfo: { ...cached, deviceId } }, false, 'setGatewayDeviceInfo');
      }
      return deviceId;
    } catch (error) {
      console.error('Gateway device id lookup failed:', error);
      return;
    }
  };

  /**
   * Resolve this machine's stable device id once for a mounted view that must
   * not act before it is known (`resolveGatewayDeviceId` also corrects a cached
   * fallback id in `gatewayDeviceInfo`).
   */
  useFetchGatewayStableDeviceId = (enabled = true): SWRResponse<string | undefined> =>
    useSWR(
      enabled ? electronKeys.gatewayStableDeviceId() : null,
      () => this.resolveGatewayDeviceId(),
      { revalidateOnFocus: false },
    );

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

import { type DataSyncConfig } from '@lobechat/electron-client-ipc';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { remoteServerService } from '@/services/electron/remoteServer';
import { type StoreSetter } from '@/store/types';

import { initialState } from '../initialState';
import { type ElectronStore } from '../store';

/**
 * Remote server actions
 */

const REMOTE_SERVER_CONFIG_KEY = 'electron:getRemoteServerConfig';

type Setter = StoreSetter<ElectronStore>;
export const remoteSyncSlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new ElectronRemoteServerActionImpl(set, get, _api);

export class ElectronRemoteServerActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  clearRemoteServerSyncError = (): void => {
    this.#set({ remoteServerSyncError: undefined }, false, 'clearRemoteServerSyncError');
  };

  connectRemoteServer = async (values: DataSyncConfig): Promise<void> => {
    if (values.storageMode === 'selfHost' && !values.remoteServerUrl) return;

    this.#set({ isConnectingServer: true });
    this.#get().clearRemoteServerSyncError();
    try {
      // Get current configuration
      const config = await remoteServerService.getRemoteServerConfig();

      // If already active, need to clear first
      if (!isEqual(config, values)) {
        await remoteServerService.setRemoteServerConfig({ ...values, active: false });
      }

      // Request authorization
      const result = await remoteServerService.requestAuthorization(values);

      if (!result.success) {
        console.error('Authorization request failed:', result.error);

        this.#set({
          remoteServerSyncError: { message: result.error, type: 'AUTH_ERROR' },
        });
      }
      // Refresh state
      await this.#get().refreshServerConfig();
    } catch (error) {
      console.error('Remote server configuration error:', error);
      this.#set({
        remoteServerSyncError: { message: (error as Error).message, type: 'CONFIG_ERROR' },
      });
    } finally {
      this.#set({ isConnectingServer: false });
    }
  };

  disconnectRemoteServer = async (): Promise<void> => {
    this.#set({ isConnectingServer: false });
    this.#get().clearRemoteServerSyncError();
    try {
      await remoteServerService.setRemoteServerConfig({ active: false, storageMode: 'cloud' });
      // Update form URL to empty
      this.#set({ dataSyncConfig: initialState.dataSyncConfig });
      // Refresh state
      await this.#get().refreshServerConfig();
    } catch (error) {
      console.error('Disconnect failed:', error);
      this.#set({
        remoteServerSyncError: { message: (error as Error).message, type: 'DISCONNECT_ERROR' },
      });
    } finally {
      this.#set({ isConnectingServer: false });
    }
  };

  refreshServerConfig = async (): Promise<void> => {
    await mutate(REMOTE_SERVER_CONFIG_KEY);
  };

  refreshUserData = async (): Promise<void> => {
    const { getSessionStoreState } = await import('@/store/session');
    const { getChatStoreState } = await import('@/store/chat');
    const { getUserStoreState } = await import('@/store/user');

    await getSessionStoreState().refreshSessions();
    await getChatStoreState().refreshMessages();
    await getChatStoreState().refreshTopic();
    await getUserStoreState().refreshUserState();
  };

  useDataSyncConfig = (): SWRResponse => {
    return useSWR<DataSyncConfig>(
      REMOTE_SERVER_CONFIG_KEY,
      async () => {
        try {
          return await remoteServerService.getRemoteServerConfig();
        } catch (error) {
          console.error('Failed to get remote server configuration:', error);
          throw error;
        }
      },
      {
        onSuccess: (data) => {
          if (!isEqual(data, this.#get().dataSyncConfig)) {
            this.#get().refreshUserData();
          }

          this.#set({ dataSyncConfig: data, isInitRemoteServerConfig: true });
        },
        suspense: false,
      },
    );
  };
}

export type ElectronRemoteServerAction = Pick<
  ElectronRemoteServerActionImpl,
  keyof ElectronRemoteServerActionImpl
>;

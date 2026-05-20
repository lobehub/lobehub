import { type DataSyncConfig } from '@lobechat/electron-client-ipc';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { remoteServerService } from '@/services/electron/remoteServer';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';

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
      // Must use clearRemoteServerConfig (not only set active: false): main process
      // clears encrypted OIDC access/refresh tokens; otherwise sign-out still leaves auth state.
      await remoteServerService.clearRemoteServerConfig();
      const { stores } = await import('@/store/utils/userDataStores');
      stores.reset();
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
    const { stores } = await import('@/store/utils/userDataStores');
    stores.reset();

    const [{ useSessionStore }, { useChatStore }] = await Promise.all([
      import('@/store/session'),
      import('@/store/chat'),
    ]);

    await useSessionStore.getState().refreshSessions();
    await useChatStore.getState().refreshMessages();
    await useChatStore.getState().refreshTopic();
    await useUserStore.getState().refreshUserState();
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
          const { dataSyncConfig, isInitRemoteServerConfig } = this.#get();
          // Only refresh on genuine config changes AFTER the first hydration.
          // On initial load the stores are already fresh, and `refreshUserData`
          // runs `stores.reset()` which wipes chat state (notably `activeAgentId`)
          // that `AgentIdSync` just set from the URL — leaving the topic list
          // unable to resolve its agent scope on reload.
          if (isInitRemoteServerConfig && !isEqual(data, dataSyncConfig)) {
            void this.#get()
              .refreshUserData()
              .catch((error) => {
                console.error('Failed to refresh user data:', error);
              });
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

import type { SWRResponse } from 'swr';

import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { globalService } from '@/services/global';
import { type StoreSetter } from '@/store/types';
import { type GlobalRuntimeConfig } from '@/types/serverConfig';

import { type ServerConfigStore } from './store';

const FETCH_SERVER_CONFIG_KEY = 'FETCH_SERVER_CONFIG';

type Setter = StoreSetter<ServerConfigStore>;
export const createServerConfigSlice = (
  set: Setter,
  get: () => ServerConfigStore,
  _api?: unknown,
) => new ServerConfigActionImpl(set, get, _api);

export class ServerConfigActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, get: () => ServerConfigStore, _api?: unknown) {
    void _api;
    this.#set = set;
    void get;
  }

  #applyRuntimeConfig = (data: GlobalRuntimeConfig, action: string) => {
    this.#set(
      {
        billboard: data.billboard ?? null,
        featureFlags: data.serverFeatureFlags,
        serverConfig: data.serverConfig,
        serverConfigInit: true,
      },
      false,
      action,
    );
  };

  refreshServerConfig = async (): Promise<void> => {
    const data = await globalService.getGlobalConfig();
    this.#applyRuntimeConfig(data, 'refreshServerConfig');
  };

  useInitServerConfig = (): SWRResponse<GlobalRuntimeConfig> => {
    return useOnlyFetchOnceSWR<GlobalRuntimeConfig>(
      FETCH_SERVER_CONFIG_KEY,
      () => globalService.getGlobalConfig(),
      {
        onError: () => {
          this.#set({ serverConfigInit: true }, false, 'initServerConfigFallback');
        },
        onSuccess: (data) => {
          this.#applyRuntimeConfig(data, 'initServerConfig');
        },
      },
    );
  };
}

export type ServerConfigAction = Pick<ServerConfigActionImpl, keyof ServerConfigActionImpl>;

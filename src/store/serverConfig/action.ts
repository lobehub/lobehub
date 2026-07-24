import { type SWRResponse } from 'swr';

import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { serverConfigKeys } from '@/libs/swr/keys';
import { globalService } from '@/services/global';
import { type StoreSetter } from '@/store/types';
import { type GlobalRuntimeConfig } from '@/types/serverConfig';

import { type ServerConfigStore } from './store';

const CLOUD_DESKTOP_BUSINESS_FEATURES_FLAG = '__LOBECLOUD_DESKTOP_BUSINESS_FEATURES__';

const setDesktopBusinessFeaturesFlag = (enableBusinessFeatures: boolean | undefined) => {
  (globalThis as unknown as Record<string, boolean | undefined>)[
    CLOUD_DESKTOP_BUSINESS_FEATURES_FLAG
  ] = Boolean(enableBusinessFeatures);
};

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

  useInitServerConfig = (): SWRResponse<GlobalRuntimeConfig> => {
    return useOnlyFetchOnceSWR<GlobalRuntimeConfig>(
      serverConfigKeys.get,
      () => globalService.getGlobalConfig(),
      {
        onError: () => {
          setDesktopBusinessFeaturesFlag(false);
          this.#set({ serverConfigInit: true }, false, 'initServerConfigFallback');
        },
        onSuccess: (data) => {
          setDesktopBusinessFeaturesFlag(data.serverConfig.enableBusinessFeatures);
          this.#set(
            {
              billboard: data.billboard ?? null,
              featureFlags: data.serverFeatureFlags,
              serverConfig: data.serverConfig,
              serverConfigInit: true,
            },
            false,
            'initServerConfig',
          );
        },
      },
    );
  };
}

export type ServerConfigAction = Pick<ServerConfigActionImpl, keyof ServerConfigActionImpl>;

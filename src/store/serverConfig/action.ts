import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { globalService } from '@/services/global';
import { type GlobalRuntimeConfig } from '@/types/serverConfig';

import type { ServerConfigStore } from './store';

const FETCH_SERVER_CONFIG_KEY = 'FETCH_SERVER_CONFIG';
export interface ServerConfigAction {
  useInitServerConfig: () => SWRResponse<GlobalRuntimeConfig>;
}

export const createServerConfigSlice: StateCreator<
  ServerConfigStore,
  [['zustand/devtools', never]],
  [],
  ServerConfigAction
> = (set) => ({
  useInitServerConfig: () => {
    return useOnlyFetchOnceSWR<GlobalRuntimeConfig>(
      FETCH_SERVER_CONFIG_KEY,
      () => globalService.getGlobalConfig(),
      {
        onSuccess: (data) => {
          set(
            {
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
  },
});

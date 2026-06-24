import { useMemo } from 'react';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import {
  BUSINESS_CHAT_PROVIDER,
  BUSINESS_HOME_NEW_MODELS,
  OSS_GLM_PROVIDER,
  OSS_HOME_NEW_MODELS,
} from './starterModels';

export const useStarterModelDefaults = () => {
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  return useMemo(
    () => ({
      defaultHomeNewModels: enableBusinessFeatures ? BUSINESS_HOME_NEW_MODELS : OSS_HOME_NEW_MODELS,
      fallbackChatProvider: enableBusinessFeatures ? BUSINESS_CHAT_PROVIDER : OSS_GLM_PROVIDER,
    }),
    [enableBusinessFeatures],
  );
};

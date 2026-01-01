import isEqual from 'fast-deep-equal';
import { useContext } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { LoadingContext } from './LoadingContext';

export const useApiKey = (provider: string) => {
  const { setLoading } = useContext(LoadingContext);
  const updateAiProviderConfig = useAiInfraStore((s) => s.updateAiProviderConfig);
  const data = useAiInfraStore(aiProviderSelectors.providerConfigById(provider), isEqual);

  return {
    apiKey: data?.keyVaults.apiKey,
    baseURL: data?.keyVaults?.baseURL,
    setConfig: async (id: string, params: Record<string, string>) => {
      const next = { ...data?.keyVaults, ...params };
      if (isEqual(data?.keyVaults, next)) return;

      setLoading(true);
      await updateAiProviderConfig(id, {
        keyVaults: { ...data?.keyVaults, ...params },
      });
      setLoading(false);
    },
  };
};

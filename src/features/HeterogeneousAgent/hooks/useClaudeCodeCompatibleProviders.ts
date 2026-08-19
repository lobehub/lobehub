import type { HeterogeneousApiConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import {
  isClaudeCodeDirectCompatible,
  validateClaudeCodeApiBinding,
} from '@/helpers/claudeCodeApiBinding';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';

export interface ClaudeCodeCompatibleProvider {
  id: string;
  name?: string;
}

export interface ClaudeCodeCompatibleModel {
  displayName?: string;
  id: string;
  providerId: string;
}

interface ClaudeCodeCompatibleProvidersResult {
  modelsByProvider: Record<string, ClaudeCodeCompatibleModel[]>;
  providers: ClaudeCodeCompatibleProvider[];
}

export const useClaudeCodeApiBindingValidation = (apiConfig?: HeterogeneousApiConfig) => {
  const isReady = useAiInfraStore(aiProviderSelectors.isInitAiProviderRuntimeState);
  const providerList = useAiInfraStore((state) => state.enabledAiProviders ?? [], isEqual);
  const runtimeConfig = useAiInfraStore((state) => state.aiProviderRuntimeConfig, isEqual);
  const enabledModels = useAiInfraStore((state) => state.enabledAiModels ?? [], isEqual);
  const providerConfig = apiConfig ? runtimeConfig[apiConfig.providerId] : undefined;

  return {
    error: validateClaudeCodeApiBinding({
      apiConfig,
      enabledModels,
      providerEnabled: !!apiConfig && providerList.some(({ id }) => id === apiConfig.providerId),
      providerSdkType: isClaudeCodeDirectCompatible(providerConfig?.settings)
        ? providerConfig?.settings.sdkType
        : undefined,
    }),
    isReady,
  };
};

/** Providers that the Desktop-local direct adapter can currently launch. */
export const useClaudeCodeCompatibleProviders = (): ClaudeCodeCompatibleProvidersResult => {
  const providerList = useAiInfraStore((state) => state.enabledAiProviders ?? [], isEqual);
  const runtimeConfig = useAiInfraStore((state) => state.aiProviderRuntimeConfig, isEqual);
  const enabledModels = useAiInfraStore((state) => state.enabledAiModels ?? [], isEqual);

  return useMemo(() => {
    const candidateProviders = providerList
      .filter((provider) => isClaudeCodeDirectCompatible(runtimeConfig[provider.id]?.settings))
      .map(({ id, name }) => ({ id, name }));
    const compatibleProviderIds = new Set(candidateProviders.map(({ id }) => id));
    const modelsByProvider: Record<string, ClaudeCodeCompatibleModel[]> = {};

    for (const model of enabledModels) {
      if (model.type !== 'chat' || !compatibleProviderIds.has(model.providerId)) continue;
      modelsByProvider[model.providerId] ??= [];
      modelsByProvider[model.providerId].push({
        displayName: model.displayName,
        id: model.id,
        providerId: model.providerId,
      });
    }

    const providers = candidateProviders.filter(({ id }) => modelsByProvider[id]?.length);
    return { modelsByProvider, providers };
  }, [enabledModels, providerList, runtimeConfig]);
};

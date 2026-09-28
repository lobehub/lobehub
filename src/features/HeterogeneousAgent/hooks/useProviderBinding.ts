import {
  type HeterogeneousProviderBindingError,
  isHeterogeneousProviderBindingSupported,
} from '@lobechat/heterogeneous-agents';
import type { HeterogeneousProviderApiConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import type { AiProviderSourceType } from '@/types/aiProvider';

export interface ProviderBindingCompatibleProvider {
  id: string;
  logo?: string;
  name?: string;
  source?: AiProviderSourceType;
}

export interface ProviderBindingCompatibleModel {
  displayName?: string;
  id: string;
  providerId: string;
}

interface CompatibleProvidersResult {
  modelsByProvider: Record<string, ProviderBindingCompatibleModel[]>;
  providers: ProviderBindingCompatibleProvider[];
}

export const useProviderBindingValidation = (
  agentType: string | undefined,
  apiConfig?: HeterogeneousProviderApiConfig,
) => {
  const isReady = useAiInfraStore(aiProviderSelectors.isInitAiProviderRuntimeState);
  const providerList = useAiInfraStore((state) => state.enabledAiProviders ?? [], isEqual);
  const bindingAgentTypes = useAiInfraStore((state) => state.providerBindingAgentTypes, isEqual);
  const enabledModels = useAiInfraStore((state) => state.enabledAiModels ?? [], isEqual);
  let error: HeterogeneousProviderBindingError | undefined;

  if (!isHeterogeneousProviderBindingSupported(agentType)) {
    error = { agentType: agentType ?? '', code: 'agentUnsupported' };
  } else if (!apiConfig?.providerId || !apiConfig.model?.trim()) {
    error = { code: 'configMissing' };
  } else if (!providerList.some(({ id }) => id === apiConfig.providerId)) {
    error = { code: 'providerUnavailable', providerId: apiConfig.providerId };
  } else if (!bindingAgentTypes[apiConfig.providerId]?.includes(agentType!)) {
    error = { agentType: agentType!, code: 'protocolMismatch', providerId: apiConfig.providerId };
  } else {
    const boundModels = [apiConfig.model, apiConfig.smallFastModel].filter(
      (model): model is string => !!model,
    );
    const unavailableModel = boundModels.find(
      (boundModel) =>
        !enabledModels.some(
          (model) =>
            model.providerId === apiConfig.providerId &&
            model.id === boundModel &&
            model.type === 'chat',
        ),
    );
    if (unavailableModel) {
      error = {
        code: 'modelUnavailable',
        model: unavailableModel,
        providerId: apiConfig.providerId,
      };
    }
  }

  return {
    error,
    isReady,
  };
};

/** Providers whose actual wire protocol intersects with the selected local agent driver. */
export const useProviderBindingCompatibleProviders = (
  agentType: string | undefined,
): CompatibleProvidersResult => {
  const providerList = useAiInfraStore((state) => state.enabledAiProviders ?? [], isEqual);
  const bindingAgentTypes = useAiInfraStore((state) => state.providerBindingAgentTypes, isEqual);
  const enabledModels = useAiInfraStore((state) => state.enabledAiModels ?? [], isEqual);

  return useMemo(() => {
    const candidateProviders = providerList.filter(
      ({ id }) => !!agentType && bindingAgentTypes[id]?.includes(agentType),
    );
    const compatibleProviderIds = new Set(candidateProviders.map(({ id }) => id));
    const modelsByProvider: Record<string, ProviderBindingCompatibleModel[]> = {};

    for (const model of enabledModels) {
      if (model.type !== 'chat' || !compatibleProviderIds.has(model.providerId)) continue;
      modelsByProvider[model.providerId] ??= [];
      modelsByProvider[model.providerId].push({
        displayName: model.displayName,
        id: model.id,
        providerId: model.providerId,
      });
    }

    const providers = candidateProviders
      .filter(({ id }) => modelsByProvider[id]?.length)
      .map(({ id, logo, name, source }) => ({ id, logo, name, source }));
    return { modelsByProvider, providers };
  }, [agentType, bindingAgentTypes, enabledModels, providerList]);
};

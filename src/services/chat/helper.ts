import { ModelProvider } from 'model-bank';

import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';

export const isCanUseVision = (model: string, provider: string): boolean => {
  return aiModelSelectors.isModelSupportVision(model, provider)(getAiInfraStoreState());
};

export const isCanUseVideo = (model: string, provider: string): boolean => {
  return aiModelSelectors.isModelSupportVideo(model, provider)(getAiInfraStoreState()) || false;
};

export const isCanUseAudio = (model: string, provider: string): boolean => {
  return aiModelSelectors.isModelSupportVideo(model, provider)(getAiInfraStoreState()) || false;
};

/**
 * TODO: we need to update this function to auto find deploymentName with provider setting config
 */
export const findDeploymentName = (model: string, provider: string) => {
  let deploymentId = model;

  // find the model by id
  const modelItem = getAiInfraStoreState().enabledAiModels?.find(
    (i) => i.id === model && i.providerId === provider,
  );

  if (modelItem && modelItem.config?.deploymentName) {
    deploymentId = modelItem.config?.deploymentName;
  }

  return deploymentId;
};

export const isEnableFetchOnClient = (provider: string) => {
  return aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState());
};

export const resolveRuntimeProvider = (provider: string) => {
  const isBuiltin = Object.values(ModelProvider).includes(provider as any);
  if (isBuiltin) return provider;

  const providerConfig = aiProviderSelectors.providerConfigById(provider)(getAiInfraStoreState());

  return providerConfig?.settings.sdkType || 'openai';
};

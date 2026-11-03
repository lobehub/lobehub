import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelSupportVision = (model: string, provider: string) => {
  return useAiInfraStore(aiModelSelectors.isModelSupportVision(model, provider));
};

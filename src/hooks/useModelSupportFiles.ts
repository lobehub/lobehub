import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelSupportFiles = (model: string, provider: string) => {
  return useAiInfraStore(aiModelSelectors.isModelSupportFiles(model, provider));
};

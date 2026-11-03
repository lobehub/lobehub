import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelSupportToolUse = (model: string, provider: string) => {
  return useAiInfraStore(aiModelSelectors.isModelSupportToolUse(model, provider));
};

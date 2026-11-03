import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelContextWindowTokens = (model: string, provider: string) => {
  const newValue = useAiInfraStore(aiModelSelectors.modelContextWindowTokens(model, provider));

  return newValue as number;
};

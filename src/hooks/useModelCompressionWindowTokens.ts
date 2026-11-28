import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

/** The window context compression budgets against, which the context usage meter measures. */
export const useModelCompressionWindowTokens = (model: string, provider: string) => {
  const newValue = useAiInfraStore(aiModelSelectors.modelCompressionWindowTokens(model, provider));

  return newValue as number;
};

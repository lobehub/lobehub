import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/selectors';

export const useModelSupportImageOutput = (id?: string, provider?: string) => {
  return useAiInfraStore((s) => {
    if (!id || !provider) return false;

    return aiModelSelectors.isModelSupportImageOutput(id, provider)(s);
  });
};

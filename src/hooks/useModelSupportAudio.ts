import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/selectors';

export const useModelSupportAudio = (id?: string, provider?: string) => {
  return useAiInfraStore((s) => {
    if (!id || !provider) return false;

    return aiModelSelectors.isModelSupportAudio(id, provider)(s);
  });
};

import isEqual from 'fast-deep-equal';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import type { AIProviderStoreState } from '@/store/aiInfra/initialState';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

export type EnabledModelListType = 'chat' | 'embedding' | 'image' | 'video';

const enabledModelListSelectorMap = {
  chat: aiProviderSelectors.enabledChatModelList,
  image: aiProviderSelectors.enabledImageModelList,
  video: aiProviderSelectors.enabledVideoModelList,
  embedding: aiProviderSelectors.enabledEmbeddingModelList,
} satisfies Record<EnabledModelListType, (s: AIProviderStoreState) => EnabledProviderWithModels[]>;

export const useEnabledModels = (modelType: EnabledModelListType): EnabledProviderWithModels[] => {
  const selector = enabledModelListSelectorMap[modelType];
  const enabledModelList = useAiInfraStore(selector, isEqual);

  return enabledModelList || [];
};

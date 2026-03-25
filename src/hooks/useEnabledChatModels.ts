import isEqual from 'fast-deep-equal';
import { type ModelAbilities } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { useMemo } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';
import { AUTO_MODEL_ID, AUTO_MODEL_PROVIDER, AUTO_MODEL_TARGET_MODEL } from '@/utils/modelAccess';

export const useEnabledChatModels = (): EnabledProviderWithModels[] => {
  const enabledChatModelList = useAiInfraStore((s) => s.enabledChatModelList, isEqual);

  return useMemo(() => {
    const list = enabledChatModelList || [];
    const moonshotProvider = list.find((item) => item.id === AUTO_MODEL_PROVIDER);
    if (!moonshotProvider) return list;

    if (moonshotProvider.children.some((m) => m.id === AUTO_MODEL_ID)) return list;

    const kimiModel = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === AUTO_MODEL_PROVIDER && m.id === AUTO_MODEL_TARGET_MODEL,
    );

    const autoModel = {
      abilities: (kimiModel?.abilities || {}) as ModelAbilities,
      contextWindowTokens: kimiModel?.contextWindowTokens,
      displayName: 'Auto',
      id: AUTO_MODEL_ID,
    };

    return list.map((item) =>
      item.id === AUTO_MODEL_PROVIDER ? { ...item, children: [autoModel, ...item.children] } : item,
    );
  }, [enabledChatModelList]);
};

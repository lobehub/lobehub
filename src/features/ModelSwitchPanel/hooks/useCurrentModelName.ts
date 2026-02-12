import { useMemo } from 'react';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

export const useCurrentModelName = (
  enabledList: EnabledProviderWithModels[],
  model: string,
): string => {
  return useMemo(() => {
    for (const providerItem of enabledList) {
      const modelItem = providerItem.children.find((m) => m.id === model);
      if (modelItem) {
        return modelItem.displayName || modelItem.id;
      }
    }
    return model;
  }, [enabledList, model]);
};

import { useMemo } from 'react';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import type { GroupMode, ModelWithProviders, VirtualItem } from './types';

export const useBuildVirtualItems = (
  enabledList: EnabledProviderWithModels[],
  groupMode: GroupMode,
): VirtualItem[] => {
  return useMemo(() => {
    if (enabledList.length === 0) {
      return [{ type: 'no-provider' }] as VirtualItem[];
    }

    if (groupMode === 'byModel') {
      // Group models by display name
      const modelMap = new Map<string, ModelWithProviders>();

      for (const providerItem of enabledList) {
        for (const modelItem of providerItem.children) {
          const displayName = modelItem.displayName || modelItem.id;

          if (!modelMap.has(displayName)) {
            modelMap.set(displayName, {
              displayName,
              model: modelItem,
              providers: [],
            });
          }

          const entry = modelMap.get(displayName)!;
          entry.providers.push({
            id: providerItem.id,
            logo: providerItem.logo,
            name: providerItem.name,
            source: providerItem.source,
          });
        }
      }

      // Convert to array and sort by display name
      return Array.from(modelMap.values())
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((data) => ({ data, type: 'model-item' as const }));
    } else {
      // Group by provider (original structure)
      const items: VirtualItem[] = [];

      for (const providerItem of enabledList) {
        // Add provider group header
        items.push({ provider: providerItem, type: 'group-header' });

        if (providerItem.children.length === 0) {
          // Add empty model placeholder
          items.push({ provider: providerItem, type: 'empty-model' });
        } else {
          // Add each model item
          for (const modelItem of providerItem.children) {
            items.push({
              model: modelItem,
              provider: providerItem,
              type: 'provider-model-item',
            });
          }
        }
      }

      return items;
    }
  }, [enabledList, groupMode]);
};

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

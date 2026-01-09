import { useMemo } from 'react';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import type { GroupMode, ModelWithProviders, VirtualItem } from '../types';

export const useBuildVirtualItems = (
  enabledList: EnabledProviderWithModels[],
  groupMode: GroupMode,
  searchKeyword: string = '',
): VirtualItem[] => {
  return useMemo(() => {
    if (enabledList.length === 0) {
      return [{ type: 'no-provider' }] as VirtualItem[];
    }

    // Filter function for search
    const matchesSearch = (text: string): boolean => {
      if (!searchKeyword.trim()) return true;
      const keyword = searchKeyword.toLowerCase().trim();
      return text.toLowerCase().includes(keyword);
    };

    // Sort providers: lobehub first, then others
    const sortedProviders = [...enabledList].sort((a, b) => {
      const aIsLobehub = a.id === 'lobehub';
      const bIsLobehub = b.id === 'lobehub';
      if (aIsLobehub && !bIsLobehub) return -1;
      if (!aIsLobehub && bIsLobehub) return 1;
      return 0;
    });

    if (groupMode === 'byModel') {
      // Group models by display name
      const modelMap = new Map<string, ModelWithProviders>();

      for (const providerItem of sortedProviders) {
        for (const modelItem of providerItem.children) {
          const displayName = modelItem.displayName || modelItem.id;

          // Filter by search keyword
          if (!matchesSearch(displayName) && !matchesSearch(providerItem.name)) {
            continue;
          }

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

      // Sort providers within each model: lobehub first
      const modelArray = Array.from(modelMap.values());
      for (const model of modelArray) {
        model.providers.sort((a, b) => {
          const aIsLobehub = a.id === 'lobehub';
          const bIsLobehub = b.id === 'lobehub';
          if (aIsLobehub && !bIsLobehub) return -1;
          if (!aIsLobehub && bIsLobehub) return 1;
          return 0;
        });
      }

      // Convert to array and sort by display name
      return modelArray
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((data) => ({
          data,
          type:
            data.providers.length === 1
              ? ('model-item-single' as const)
              : ('model-item-multiple' as const),
        }));
    } else {
      // Group by provider (original structure)
      const items: VirtualItem[] = [];

      for (const providerItem of sortedProviders) {
        // Filter models by search keyword
        const filteredModels = providerItem.children.filter(
          (modelItem) =>
            matchesSearch(modelItem.displayName || modelItem.id) ||
            matchesSearch(providerItem.name),
        );

        // Only add provider group header if there are matching models or if search is empty
        if (filteredModels.length > 0 || !searchKeyword.trim()) {
          // Add provider group header
          items.push({ provider: providerItem, type: 'group-header' });

          if (filteredModels.length === 0) {
            // Add empty model placeholder
            items.push({ provider: providerItem, type: 'empty-model' });
          } else {
            // Add each filtered model item
            for (const modelItem of filteredModels) {
              items.push({
                model: modelItem,
                provider: providerItem,
                type: 'provider-model-item',
              });
            }
          }
        }
      }

      return items;
    }
  }, [enabledList, groupMode, searchKeyword]);
};

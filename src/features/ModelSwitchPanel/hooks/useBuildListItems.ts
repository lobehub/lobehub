import { useMemo } from 'react';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { type GroupMode, type ListItem, type ModelWithProviders } from '../types';

export const buildListItems = (
  enabledList: EnabledProviderWithModels[],
  groupMode: GroupMode,
  searchKeyword: string = '',
  sortModelLast?: (modelId: string, providerId: string) => boolean,
): ListItem[] => {
  if (enabledList.length === 0) {
    return [{ type: 'no-provider' }] as ListItem[];
  }

  const matchesSearch = (text: string): boolean => {
    if (!searchKeyword.trim()) return true;
    const keyword = searchKeyword.toLowerCase().trim();
    return text.toLowerCase().includes(keyword);
  };

  // lobehub first, then others
  const sortedProviders = [...enabledList].sort((a, b) => {
    const aIsLobehub = a.id === 'lobehub';
    const bIsLobehub = b.id === 'lobehub';
    if (aIsLobehub && !bIsLobehub) return -1;
    if (!aIsLobehub && bIsLobehub) return 1;
    return 0;
  });

  if (groupMode === 'byModel') {
    const modelMap = new Map<string, ModelWithProviders>();

    for (const providerItem of sortedProviders) {
      for (const modelItem of providerItem.children) {
        const displayName = modelItem.displayName || modelItem.id;

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

    // lobehub first
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

    const sortedModels = sortModelLast
      ? modelArray.toSorted((a, b) => {
          const aLast = a.providers.every((provider) => sortModelLast(a.model.id, provider.id));
          const bLast = b.providers.every((provider) => sortModelLast(b.model.id, provider.id));

          return Number(aLast) - Number(bLast);
        })
      : modelArray;

    return sortedModels.map((data) => ({
      data,
      type:
        data.providers.length === 1
          ? ('model-item-single' as const)
          : ('model-item-multiple' as const),
    }));
  } else {
    const items: ListItem[] = [];

    for (const providerItem of sortedProviders) {
      const filteredModels = providerItem.children.filter(
        (modelItem) =>
          matchesSearch(modelItem.displayName || modelItem.id) || matchesSearch(providerItem.name),
      );
      const sortedModels = sortModelLast
        ? filteredModels.toSorted(
            (a, b) =>
              Number(sortModelLast(a.id, providerItem.id)) -
              Number(sortModelLast(b.id, providerItem.id)),
          )
        : filteredModels;

      if (sortedModels.length > 0 || !searchKeyword.trim()) {
        items.push({ provider: providerItem, type: 'group-header' });

        if (sortedModels.length === 0) {
          items.push({ provider: providerItem, type: 'empty-model' });
        } else {
          for (const modelItem of sortedModels) {
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
};

export const useBuildListItems = (
  enabledList: EnabledProviderWithModels[],
  groupMode: GroupMode,
  searchKeyword: string = '',
  sortModelLast?: (modelId: string, providerId: string) => boolean,
): ListItem[] =>
  useMemo(
    () => buildListItems(enabledList, groupMode, searchKeyword, sortModelLast),
    [enabledList, groupMode, searchKeyword, sortModelLast],
  );

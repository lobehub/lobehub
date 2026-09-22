import dayjs from 'dayjs';
import { useMemo } from 'react';

import { type EnabledProviderWithModels } from '@/types/aiProvider';
import { isNewReleaseDate } from '@/utils/time';

import { type GroupMode, type ListItem, type ModelWithProviders } from '../types';

/**
 * Shares the exact rule behind `NewModelBadge`, so a model is pinned to the top only while its
 * badge is still visible. Every renderer of this list must keep the badge on — otherwise models
 * jump ahead with no visible explanation.
 */
const isNewModel = (releasedAt?: string): boolean => !!releasedAt && isNewReleaseDate(releasedAt);

/**
 * Pins new models to the top, then orders them newest-first. Ranking the pinned models by
 * `displayOrder` instead would surface whichever vendor happens to sit earliest in the catalog,
 * so a model released days earlier could outrank today's launch under the same "new" badge.
 *
 * Same-day releases fall through to 0 and keep `displayOrder` via stable sort.
 */
const compareNewness = (a?: string, b?: string): number => {
  const aNew = isNewModel(a);
  const bNew = isNewModel(b);
  if (aNew !== bNew) return aNew ? -1 : 1;
  if (!aNew) return 0;

  return dayjs(b).valueOf() - dayjs(a).valueOf();
};

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

    const sortedModels = modelArray.toSorted((a, b) => {
      if (sortModelLast) {
        const aLast = a.providers.every((provider) => sortModelLast(a.model.id, provider.id));
        const bLast = b.providers.every((provider) => sortModelLast(b.model.id, provider.id));
        if (aLast !== bLast) return Number(aLast) - Number(bLast);
      }
      return compareNewness(a.model.releasedAt, b.model.releasedAt);
    });

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
      const sortedModels = filteredModels.toSorted((a, b) => {
        if (sortModelLast) {
          const diff =
            Number(sortModelLast(a.id, providerItem.id)) -
            Number(sortModelLast(b.id, providerItem.id));
          if (diff !== 0) return diff;
        }
        return compareNewness(a.releasedAt, b.releasedAt);
      });

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

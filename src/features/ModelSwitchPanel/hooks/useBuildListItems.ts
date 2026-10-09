import dayjs from 'dayjs';
import { useMemo } from 'react';

import { type EnabledProviderWithModels } from '@/types/aiProvider';
import { isNewReleaseDate } from '@/utils/time';

import { type GroupMode, type ListItem, type ModelWithProviders } from '../types';

/**
 * Shares the exact rule behind `NewModelBadge`. Every renderer of this list must keep the badge
 * on — otherwise pinned models jump ahead with no visible explanation.
 */
const isNewModel = (releasedAt?: string): boolean => !!releasedAt && isNewReleaseDate(releasedAt);

/**
 * Caps how many new models jump ahead of the catalog order. A busy launch week can badge many
 * models at once; pinning all of them would push every established model out of the first screen.
 * New models beyond the cap keep their badge but stay in their catalog position.
 */
export const MAX_PINNED_NEW_MODELS = 4;

/**
 * Pins at most {@link MAX_PINNED_NEW_MODELS} new models to the top, newest-first, and keeps the
 * remaining items in catalog order. Ranking the pinned models by `displayOrder` instead would
 * surface whichever vendor happens to sit earliest in the catalog, so a model released days
 * earlier could outrank today's launch under the same "new" badge.
 *
 * Items flagged by `isLast` sink below everything else and are never pinned. Same-day releases
 * keep `displayOrder` via stable sort.
 */
const sortWithPinnedNewModels = <T>(
  items: T[],
  getReleasedAt: (item: T) => string | undefined,
  isLast?: (item: T) => boolean,
): T[] => {
  const pinned = items
    .filter((item) => !isLast?.(item) && isNewModel(getReleasedAt(item)))
    .toSorted((a, b) => dayjs(getReleasedAt(b)).valueOf() - dayjs(getReleasedAt(a)).valueOf())
    .slice(0, MAX_PINNED_NEW_MODELS);
  const pinnedSet = new Set(pinned);
  const rest = items.filter((item) => !pinnedSet.has(item));

  return [
    ...pinned,
    ...(isLast ? rest.toSorted((a, b) => Number(isLast(a)) - Number(isLast(b))) : rest),
  ];
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

    const sortedModels = sortWithPinnedNewModels(
      modelArray,
      (item) => item.model.releasedAt,
      sortModelLast &&
        ((item) => item.providers.every((provider) => sortModelLast(item.model.id, provider.id))),
    );

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
      const sortedModels = sortWithPinnedNewModels(
        filteredModels,
        (item) => item.releasedAt,
        sortModelLast && ((item) => sortModelLast(item.id, providerItem.id)),
      );

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

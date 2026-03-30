import { isEqual } from 'es-toolkit';

import type { ResourceItem, ResourceQueryParams } from '@/types/resource';

export const getResourceQueryKey = (params?: ResourceQueryParams | null) => {
  if (!params) return 'resource-query:default';

  return JSON.stringify({
    category: params.category ?? null,
    libraryId: params.libraryId ?? null,
    parentId: params.parentId ?? null,
    q: params.q ?? null,
    showFilesInKnowledgeBase: params.showFilesInKnowledgeBase ?? null,
    sorter: params.sorter ?? null,
    sortType: params.sortType ?? null,
  });
};

export const mergeServerResourcesWithOptimistic = (
  serverItems: ResourceItem[],
  localResourceMap: Map<string, ResourceItem>,
  queryParams?: ResourceQueryParams | null,
) => {
  const queryKey = getResourceQueryKey(queryParams);
  const serverMap = new Map(serverItems.map((item) => [item.id, item]));

  const optimisticItems = Array.from(localResourceMap.values()).filter(
    (item) => item._optimistic?.queryKey === queryKey,
  );

  const optimisticById = new Map<string, ResourceItem>();
  const optimisticOnlyItems: ResourceItem[] = [];

  for (const item of optimisticItems) {
    if (serverMap.has(item.id)) {
      optimisticById.set(item.id, item);
      continue;
    }

    optimisticOnlyItems.push(item);
  }

  const mergedList = [
    ...optimisticOnlyItems,
    ...serverItems.map((item) => optimisticById.get(item.id) ?? item),
  ];
  const mergedMap = new Map(localResourceMap);

  for (const item of mergedList) {
    mergedMap.set(item.id, item);
  }

  return {
    changed:
      !isEqual(mergedList, serverItems) ||
      optimisticOnlyItems.length > 0 ||
      optimisticById.size > 0,
    resourceList: mergedList,
    resourceMap: mergedMap,
  };
};

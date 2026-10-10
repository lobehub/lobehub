import type { TrashResourceType } from '@lobechat/types';

import type { TrashState } from './initialState';
import { trashListKey } from './projection';

/** The loaded page of one filter, or `undefined` before its first paint. */
const currentList = (activeType?: TrashResourceType) => (s: TrashState) =>
  s.trashListMap[trashListKey(activeType)];

const countByType = (s: TrashState) => s.trashCountMap[trashListKey()] ?? {};

const totalCount = (s: TrashState) =>
  Object.values(countByType(s)).reduce((sum, count) => sum + (count ?? 0), 0);

/** The active filter's page is loaded and empty (not merely un-fetched). */
const isEmpty = (activeType?: TrashResourceType) => (s: TrashState) => {
  const list = s.trashListMap[trashListKey(activeType)];
  return !!list && list.items.length === 0;
};

const isLoading = (id: string) => (s: TrashState) => s.loadingIds.includes(id);

export const trashSelectors = { countByType, currentList, isEmpty, isLoading, totalCount };

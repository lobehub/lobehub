import type { TrashCountByType, TrashProjectFilter } from '@lobechat/types';

import type { TrashState } from './initialState';
import { trashCountKey, trashListKey, type TrashListParams } from './projection';

/** The project filter that applies in `scope`; a selection made in another scope does not. */
const activeProjectId =
  (scope: string) =>
  (s: TrashState): TrashProjectFilter =>
    s.projectSelection?.scope === scope ? s.projectSelection.projectId : undefined;

/** The loaded page of one view, or `undefined` before its first paint. */
const currentList = (filter: TrashListParams) => (s: TrashState) =>
  s.trashListMap[trashListKey(filter)];

/** Per-type counts of one project filter, or `undefined` before they first load. */
const countByType =
  (projectId?: TrashProjectFilter) =>
  (s: TrashState): TrashCountByType | undefined =>
    s.trashCountMap[trashCountKey(projectId)];

const sumCounts = (counts: TrashCountByType | undefined) =>
  Object.values(counts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);

const totalCount = (projectId?: TrashProjectFilter) => (s: TrashState) =>
  sumCounts(countByType(projectId)(s));

/**
 * Roots one view covers — what "empty" would purge — or `undefined` while
 * its counts are not loaded yet.
 */
const filterCount = (filter: TrashListParams) => (s: TrashState) => {
  const counts = countByType(filter.projectId)(s);
  if (!counts) return undefined;
  return filter.resourceType ? (counts[filter.resourceType] ?? 0) : sumCounts(counts);
};

/** The view's page is loaded and empty (not merely un-fetched). */
const isEmpty = (filter: TrashListParams) => (s: TrashState) => {
  const list = s.trashListMap[trashListKey(filter)];
  return !!list && list.items.length === 0;
};

const isLoading = (id: string) => (s: TrashState) => s.loadingIds.includes(id);

export const trashSelectors = {
  activeProjectId,
  countByType,
  currentList,
  filterCount,
  isEmpty,
  isLoading,
  totalCount,
};

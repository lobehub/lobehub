import type { TrashCountByType, TrashProjectFilter, TrashVisibility } from '@lobechat/types';

import type { TrashCountFilter } from '@/services/trash';

import type { TrashState } from './initialState';
import { trashCountKey, trashListKey, type TrashListParams } from './projection';

/** The project filter that applies in `scope`; a selection made in another scope does not. */
const activeProjectId =
  (scope: string) =>
  (s: TrashState): TrashProjectFilter =>
    s.projectSelection?.scope === scope ? s.projectSelection.projectId : undefined;

/** The side of the bin on screen: a workspace bin opens on its public side; a personal one has none. */
const activeVisibility =
  (inWorkspace: boolean) =>
  (s: TrashState): TrashVisibility | undefined =>
    inWorkspace ? (s.activeVisibility ?? 'public') : undefined;

/** The loaded page of one view, or `undefined` before its first paint. */
const currentList = (filter: TrashListParams) => (s: TrashState) =>
  s.trashListMap[trashListKey(filter)];

/** Per-type counts of one side and project filter, or `undefined` before they first load. */
const countByType =
  (filter?: TrashCountFilter) =>
  (s: TrashState): TrashCountByType | undefined =>
    s.trashCountMap[trashCountKey(filter)];

const sumCounts = (counts: TrashCountByType | undefined) =>
  Object.values(counts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);

const totalCount = (filter?: TrashCountFilter) => (s: TrashState) =>
  sumCounts(countByType(filter)(s));

/**
 * Roots one view covers — what "empty" would purge — or `undefined` while
 * its counts are not loaded yet.
 */
const filterCount = (filter: TrashListParams) => (s: TrashState) => {
  const counts = countByType({ projectId: filter.projectId, visibility: filter.visibility })(s);
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
  activeVisibility,
  countByType,
  currentList,
  filterCount,
  isEmpty,
  isLoading,
  totalCount,
};

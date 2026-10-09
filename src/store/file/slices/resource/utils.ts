import { type ResourceQueryParams } from '@/types/resource';

import { type ResourceListParams } from './projection';

/**
 * Query fields that select a different *pool* of resources rather than a
 * different arrangement of the same one. Changing any of them is a navigation:
 * the rows on screen stop being an answer to the question now being asked, so
 * the replica drops them (and hydrates the new pool's persisted page) and the
 * views show a skeleton. `sorter` / `sortType` / `q` are deliberately absent —
 * they re-ask the same pool and are handled without a reset.
 *
 * Lives here (not in the Explorer) so the replica's hydration and the views'
 * skeleton agree on what counts as a navigation.
 */
export const RESOURCE_POOL_KEYS = [
  'category',
  'libraryId',
  'parentId',
  'sourceFilter',
  'visibility',
] as const satisfies readonly (keyof ResourceQueryParams)[];

/** Stable identity of the pool a list query answers (used to detect navigation). */
export const getResourcePoolKey = (params?: ResourceListParams | null): string =>
  JSON.stringify(RESOURCE_POOL_KEYS.map((key) => params?.[key] ?? null));

/**
 * Stable identity of one explorer list query. The replica now owns query
 * identity via `resourceListResource.query`; this is kept for the document
 * slice, which stamps `ResourceItem._optimistic.queryKey` with it.
 */
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

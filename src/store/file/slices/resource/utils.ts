import { type ResourceQueryParams } from '@/types/resource';

import { type ResourceListParams } from './projection';

/**
 * Query fields that select a different *pool* of resources rather than a
 * different arrangement of the same one. Changing any of them is a navigation:
 * the rows on screen stop being an answer to the question now being asked, so
 * the views show a skeleton instead of the stale list. `sorter` / `sortType` /
 * `q` are deliberately absent — they re-ask the same pool.
 *
 * Lives here (not in the Explorer) so every consumer of "what counts as a
 * navigation" reads one list.
 */
export const RESOURCE_POOL_KEYS = [
  'category',
  'libraryId',
  'parentId',
  'sourceFilter',
  'visibility',
] as const satisfies readonly (keyof ResourceQueryParams)[];

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

/**
 * The pool fields an optimistic row's `_optimistic.queryKey` carries (see
 * `getResourceQueryKey`). `sourceFilter` / `visibility` are not part of the row
 * key, but those switches clear the painted rows outright, so a surviving
 * client-only row only ever needs re-checking against these.
 */
const OPTIMISTIC_POOL_FIELDS = ['category', 'libraryId', 'parentId'] as const;

/**
 * Whether a locally inserted row (an in-flight upload / create) belongs to the
 * pool the Explorer is showing. A head refresh for the same pool must keep it —
 * even a re-sort or a view-mode change — while a refresh for another folder or
 * library must not surface it there.
 */
export const isOptimisticRowInRequestedPool = (
  queryKey: string | undefined,
  params?: ResourceListParams | null,
): boolean => {
  if (!queryKey) return false;

  try {
    const parsed = JSON.parse(queryKey) as Record<string, unknown>;
    return OPTIMISTIC_POOL_FIELDS.every(
      (field) => (parsed[field] ?? null) === (params?.[field] ?? null),
    );
  } catch {
    return false;
  }
};

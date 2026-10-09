import { type ResourceQueryParams } from '@/types/resource';

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

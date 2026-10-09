import { definePagedReplica, type ReplicaPagedData } from '@/libs/replica';
import { type FilesTabs, type ResourceSourceFilter, type SortType } from '@/types/files';
import { type ResourceItem, type ResourceQueryParams } from '@/types/resource';

/**
 * The resource explorer shows one list at a time, so the replica keeps a single
 * entry: a query change repaints from its own head page instead of ever sharing
 * (or resetting) a bucket across folders, libraries or filter chips.
 */
export const RESOURCE_LIST_KEY = 'current';

/** Page size used when the caller does not name one (the legacy `limit: 50`). */
export const DEFAULT_RESOURCE_PAGE_SIZE = 50;

/**
 * Query identity of the explorer list. `limit` / `offset` are deliberately
 * absent — the replica owns the paging cursor — and are replaced by `pageSize`.
 */
export interface ResourceListParams {
  category?: FilesTabs;
  includeContentPreview?: boolean;
  libraryId?: string;
  /**
   * Rows per page; part of the query identity (a different page size is a
   * different list). Optional so a legacy caller may seed the flat view fields
   * directly; the fetch defaults it.
   */
  pageSize?: number;
  parentId?: string | null;
  q?: string;
  showFilesInKnowledgeBase?: boolean;
  sorter?: 'name' | 'createdAt' | 'size';
  sortType?: SortType;
  sourceFilter?: ResourceSourceFilter;
  visibility?: 'private' | 'public';
}

/**
 * The explorer list view: the generic local-first paged data plus the query it
 * answers, so the surface can tell whether the painted page set still matches
 * the request on screen.
 */
export interface ResourceListValue extends ReplicaPagedData<ResourceItem, number> {
  /** Absent only for a view seeded by a legacy caller outside a known query. */
  queryParams?: ResourceListParams;
}

/**
 * Trim the caller's `ResourceQueryParams` down to the list query identity:
 * drops the paging cursor, defaults the page size and normalizes an empty
 * keyword to "no keyword" so it never splits one query into two entries.
 */
export const normalizeResourceListParams = (
  input: ResourceQueryParams | null | undefined,
): ResourceListParams | null => {
  if (!input) return null;

  return {
    category: input.category,
    includeContentPreview: input.includeContentPreview || undefined,
    libraryId: input.libraryId,
    pageSize: input.limit ?? DEFAULT_RESOURCE_PAGE_SIZE,
    parentId: input.parentId ?? null,
    q: input.q?.trim() || undefined,
    showFilesInKnowledgeBase: input.showFilesInKnowledgeBase ?? false,
    sorter: input.sorter,
    sortType: input.sortType,
    sourceFilter: input.sourceFilter,
    visibility: input.visibility,
  };
};

/**
 * The resource explorer list (`resourceService.queryResources`): a local-first
 * paged replica, so the explorer paints the persisted head page on the first
 * frame, the network confirms it, and "load more" appends through the engine.
 */
export const resourceListResource = definePagedReplica<
  ResourceListParams,
  ResourceItem,
  number,
  ResourceListValue
>({
  key: () => RESOURCE_LIST_KEY,
  name: 'resourceList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: ({
    category,
    includeContentPreview,
    libraryId,
    pageSize,
    parentId,
    q,
    showFilesInKnowledgeBase,
    sorter,
    sortType,
    sourceFilter,
    visibility,
  }) => ({
    category,
    includeContentPreview,
    libraryId,
    pageSize,
    parentId,
    q,
    showFilesInKnowledgeBase,
    sorter,
    sortType,
    sourceFilter,
    visibility,
  }),
  storage: 'indexedDB',
  version: 1,
});

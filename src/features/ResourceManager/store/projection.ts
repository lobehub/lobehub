import { definePagedReplica, type ReplicaPagedData } from '@/libs/replica';
import { type FilesTabs, type ResourceSourceFilter } from '@/types/files';
import { type ResourceItem } from '@/types/resource';

/**
 * Query identity of the explorer's search overlay (`q` + the chips the user is
 * looking through). `page` is NOT here — it is the paging cursor, owned by the
 * replica.
 */
export interface ExplorerSearchParams {
  category?: FilesTabs;
  includeContentPreview?: boolean;
  libraryId?: string;
  pageSize?: number;
  q: string;
  sourceFilter?: ResourceSourceFilter;
  visibility?: 'private' | 'public';
}

/** Query identity of the library sidebar's flat search list. */
export interface HierarchySearchParams {
  libraryId: string;
  pageSize?: number;
  q: string;
}

/**
 * Each search surface keeps ONE entry: the ResourceManager shows one query at a
 * time, so a new keyword repaints from its own head page instead of leaving a
 * persisted bucket behind for every keystroke. The keyword itself is part of the
 * query identity, so a projection taken under another search never hydrates and
 * never merges with the loaded pages.
 */
export const EXPLORER_SEARCH_KEY = 'explorer';
export const HIERARCHY_SEARCH_KEY = 'hierarchy';

/** Rows fetched per page when the caller does not name one (the legacy `limit: 50`). */
export const DEFAULT_SEARCH_PAGE_SIZE = 50;

/** The replica value plus the query it answers, so a surface can tell whether it is current. */
export type SearchReplicaValue<TParams> = ReplicaPagedData<ResourceItem, number> & {
  /** Absent only on a view written before its query identity was known. */
  searchParams?: TParams;
};

export type ExplorerSearchValue = SearchReplicaValue<ExplorerSearchParams>;
export type HierarchySearchValue = SearchReplicaValue<HierarchySearchParams>;

/**
 * The explorer search overlay (`resourceService.queryResources` narrowed by a
 * keyword): a local-first paged replica, so re-opening a search paints the
 * persisted head page on the first frame, the network confirms it, and "load
 * more" appends further pages.
 */
export const explorerSearchResource = definePagedReplica<
  ExplorerSearchParams,
  ResourceItem,
  number,
  ExplorerSearchValue
>({
  key: () => EXPLORER_SEARCH_KEY,
  name: 'resourceManagerSearch',
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
    q,
    sourceFilter,
    visibility,
  }) => ({
    category,
    includeContentPreview,
    libraryId,
    pageSize,
    q: q.trim() || undefined,
    sourceFilter,
    visibility,
  }),
  storage: 'indexedDB',
  version: 1,
});

/**
 * The library sidebar's flat search list, which replaces the folder tree while
 * the user has a query typed. It grows by whole pages as the user scrolls,
 * which is exactly an `offset` replica's `loadMore`, so the rows keep the
 * persisted head page across a reopen instead of flashing a skeleton.
 */
export const hierarchySearchResource = definePagedReplica<
  HierarchySearchParams,
  ResourceItem,
  number,
  HierarchySearchValue
>({
  key: () => HIERARCHY_SEARCH_KEY,
  name: 'resourceManagerHierarchySearch',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    persist: { pages: 1 },
  },
  query: ({ libraryId, pageSize, q }) => ({ libraryId, pageSize, q: q.trim() || undefined }),
  storage: 'indexedDB',
  version: 1,
});

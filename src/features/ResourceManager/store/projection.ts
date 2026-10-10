import { definePagedReplica, type ReplicaPagedData, stableQueryKey } from '@/libs/replica';
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
 * Each search surface keeps ONE replica entry **per query**, exactly like the
 * SWR cache it replaced. The ResourceManager shows one query at a time, but
 * keying entries by the query (not by a shared constant) is what lets coming
 * back to a keyword paint its own rows again, and keeps a projection taken
 * under another search from ever merging with the loaded pages. The store
 * bounds how many of these entries survive, so routine searching cannot grow
 * memory or IndexedDB without limit (see `MAX_RECENT_SEARCHES`).
 */

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
  // One entry per query: the keyword and every narrowing chip the user picked.
  key: (params) => stableQueryKey(params),
  name: 'resourceManagerSearch',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
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
  // One entry per (library, keyword) so revisiting a keyword restores its rows.
  key: (params) => stableQueryKey(params),
  name: 'resourceManagerHierarchySearch',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    persist: { pages: 1 },
  },
  storage: 'indexedDB',
  version: 1,
});

import { definePagedReplica, defineReplica, type ReplicaPagedData } from '@/libs/replica';
import { type FileListItem, type QueryFileListParams } from '@/types/files';

/** One crumb of a folder's ancestor chain. */
export interface FolderCrumb {
  id: string;
  name: string;
  slug: string;
}

/** The knowledge-item list is not partitioned: one entry per scope. */
export const FILE_LIST_KEY = 'all';

/** Page size when the caller does not name one. */
export const DEFAULT_FILE_LIST_PAGE_SIZE = 50;

/**
 * Params of one knowledge-item list page: the server-side filters plus the page
 * size. The window start (`offset`) is NOT here — it is the replica's paging
 * cursor, which the fetcher reads off this resource.
 */
export interface FileListParams extends Omit<QueryFileListParams, 'limit' | 'offset'> {
  pageSize: number;
}

/**
 * The knowledge-item list view: the generic local-first paged data. The list
 * lives in `FilesStoreState.fileList` (a flat array, where every existing
 * reader expects it) with the paging bookkeeping in `fileListMeta`.
 */
export interface FileListData extends ReplicaPagedData<FileListItem, number> {}
export type FileListMeta = Omit<FileListData, 'items'>;

/**
 * The explorer / picker's knowledge-item list (`fileService.getKnowledgeItems`):
 * a local-first paged replica, so a reload or a return to the route paints the
 * persisted head page on the first frame, the network confirms it, and "load
 * more" appends further pages through the engine.
 *
 * Filters are the query identity: a projection taken under other filters never
 * paints, and an un-loaded list never reads as an empty one.
 *
 * Cursor mode, with the raw window start as the cursor: the endpoint pages by
 * row offset, reports `hasMore` instead of a total, and filters rows out *after*
 * paging (folders in the Inbox) — so a page can be short and its visible count
 * is not a position. Carrying the offset keeps "is there more" exactly the
 * server's answer, instead of a count derived from mixed units.
 */
export const fileListResource = definePagedReplica<
  FileListParams,
  FileListItem,
  number,
  FileListData
>({
  key: () => FILE_LIST_KEY,
  name: 'fileList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'cursor',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: (params) => params,
  storage: 'indexedDB',
  version: 1,
});

/**
 * One knowledge item by id (`fileDetailMap[id]`).
 *
 * Wrapped in an object on purpose: a replica value can never be `null` (the
 * engine reads `null` as "keep the current value"), but a page must tell "the
 * server answered not found" (`file: null`) apart from "nothing loaded yet"
 * (no entry at all).
 */
export interface FileDetailValue {
  /** The row, or `null` when the server has no such item. */
  file: FileListItem | null;
}

/** By-id knowledge-item detail, for items outside the loaded list page. */
export const fileDetailResource = defineReplica<string, FileDetailValue>({
  key: (id) => id,
  name: 'fileDetail',
  storage: 'indexedDB',
  version: 1,
});

/**
 * A folder's ancestor chain, keyed by the folder slug (`folderBreadcrumbMap[slug]`).
 * Read-only and immutable per slug, so naming a folder repaints from its own
 * head — a stale chain can never be patched in place.
 */
export const folderBreadcrumbResource = defineReplica<string, FolderCrumb[]>({
  key: (slug) => slug,
  name: 'folderBreadcrumb',
  storage: 'indexedDB',
  version: 1,
});

import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { type ReplicaPagedData } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

import {
  defineUserMemoryPagedReplica,
  MAX_RECENT_MEMORY_QUERIES,
  memoryListKey,
} from '../../utils/replica';

/** Server-side ordering of the context list. */
export type ContextListSort = 'capturedAt' | 'scoreImpact' | 'scoreUrgency';

/** Page size the memory context list asks for when the caller does not name one. */
export const CONTEXT_LIST_PAGE_SIZE = 12;

/**
 * Query of one page set. `page` is NOT here — it is the paging cursor, owned by
 * the replica. Everything but `pageSize` is the entry key (`memoryListKey`).
 */
export interface ContextListParams {
  pageSize: number;
  q?: string;
  sort?: ContextListSort;
}

/** One page set of the context list, tagged with the query it answers. */
export interface ContextListData extends ReplicaPagedData<DisplayContextMemory, number> {
  q?: string;
  sort?: ContextListSort;
}

/**
 * The user-memory context list: a local-first, offset-paged replica with one
 * entry per search / sort (see `MemoryQueryList`). Each query paints its
 * persisted head page on the first frame and the network confirms it.
 *
 * It adopts the long-standing `userMemory:contexts` SWR key as its sync key, so
 * code that revalidates the list by its key root (`purgeAllMemories`,
 * `updateMemory`) reaches it.
 */
export const contextListResource = defineUserMemoryPagedReplica<
  ContextListParams,
  DisplayContextMemory,
  number,
  ContextListData
>({
  key: memoryListKey,
  name: 'contextList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  // Bounded: least recently used queries leave IndexedDB and memory together;
  // the query on screen is pinned by its mounted `useSync`.
  persist: { maxEntries: MAX_RECENT_MEMORY_QUERIES },
  storage: 'indexedDB',
  syncKey: (params) => userMemoryKeys.contexts(params),
  version: 1,
});

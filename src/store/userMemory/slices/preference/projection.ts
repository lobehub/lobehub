import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { type ReplicaPagedData } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

import {
  defineUserMemoryPagedReplica,
  MAX_RECENT_MEMORY_QUERIES,
  memoryListKey,
} from '../../utils/replica';

/** Server-side ordering of the preference list (`QueryUserMemoriesSort`). */
export type PreferenceListSort = 'capturedAt' | 'scorePriority';

/** Page size the memory preference list asks for when the caller does not name one. */
export const PREFERENCE_LIST_PAGE_SIZE = 12;

/**
 * Query of one page set. `page` is NOT here — it is the paging cursor, owned by
 * the replica. Everything but `pageSize` is the entry key (`memoryListKey`).
 */
export interface PreferenceListParams {
  pageSize: number;
  q?: string;
  sort?: PreferenceListSort;
}

/** One page set of the preference list, tagged with the query it answers. */
export interface PreferenceListData extends ReplicaPagedData<DisplayPreferenceMemory, number> {
  q?: string;
  sort?: PreferenceListSort;
}

/**
 * The user-memory preference list: a local-first, offset-paged replica with one
 * entry per search / sort (see `MemoryQueryList`). Each query paints its
 * persisted head page on the first frame and the network confirms it.
 *
 * It adopts the long-standing `userMemory:preferences` SWR key as its sync key, so
 * code that revalidates the list by its key root (`purgeAllMemories`,
 * `updateMemory`) reaches it.
 */
export const preferenceListResource = defineUserMemoryPagedReplica<
  PreferenceListParams,
  DisplayPreferenceMemory,
  number,
  PreferenceListData
>({
  key: memoryListKey,
  name: 'preferenceList',
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
  syncKey: (params) => userMemoryKeys.preferences(params),
  version: 1,
});

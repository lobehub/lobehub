import { type ExperienceListItem, type ExperienceListSort } from '@lobechat/types';

import { type ReplicaPagedData } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

import {
  defineUserMemoryPagedReplica,
  MAX_RECENT_MEMORY_QUERIES,
  memoryListKey,
} from '../../utils/replica';

export type { ExperienceListSort };

/** Page size the memory experience list asks for when the caller does not name one. */
export const EXPERIENCE_LIST_PAGE_SIZE = 12;

/**
 * Query of one page set. `page` is NOT here — it is the paging cursor, owned by
 * the replica. Everything but `pageSize` is the entry key (`memoryListKey`).
 */
export interface ExperienceListParams {
  pageSize: number;
  q?: string;
  sort?: ExperienceListSort;
}

/** One page set of the experience list, tagged with the query it answers. */
export interface ExperienceListData extends ReplicaPagedData<ExperienceListItem, number> {
  q?: string;
  sort?: ExperienceListSort;
}

/**
 * The user-memory experience list: a local-first, offset-paged replica with one
 * entry per search / sort (see `MemoryQueryList`). Each query paints its
 * persisted head page on the first frame and the network confirms it.
 *
 * It adopts the long-standing `userMemory:experiences` SWR key as its sync key, so
 * code that revalidates the list by its key root (`purgeAllMemories`,
 * `updateMemory`) reaches it.
 */
export const experienceListResource = defineUserMemoryPagedReplica<
  ExperienceListParams,
  ExperienceListItem,
  number,
  ExperienceListData
>({
  key: memoryListKey,
  name: 'experienceList',
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
  syncKey: (params) => userMemoryKeys.experiences(params),
  version: 1,
});

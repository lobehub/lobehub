import { type ExperienceListItem, type ExperienceListSort } from '@lobechat/types';

import { definePagedReplica, type ReplicaPagedData } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

export type { ExperienceListSort };

/** Page size the memory experience list asks for when the caller does not name one. */
export const EXPERIENCE_LIST_PAGE_SIZE = 12;

/** The experience list is never partitioned per container: one entry per scope. */
export const EXPERIENCE_LIST_KEY = 'all';

/**
 * Query identity of one page set. `page` is NOT here — it is the paging cursor,
 * owned by the replica. `q` / `sort` change the rows the server returns, so a
 * projection taken under other values never paints.
 */
export interface ExperienceListParams {
  pageSize: number;
  q?: string;
  sort?: ExperienceListSort;
}

/**
 * The experience list view: the generic local-first paged data plus the query
 * descriptors it was fetched with, so the surface can tell whether the painted
 * page set still answers the request on screen.
 */
export interface ExperienceListData extends ReplicaPagedData<ExperienceListItem, number> {
  q?: string;
  sort?: ExperienceListSort;
}

/**
 * The user-memory experience list (`userMemoryService.queryExperiences`): a
 * local-first paged replica, so the memory page paints the persisted head page
 * on the first frame, the network confirms it, and "load more" appends further
 * pages through the engine instead of a hand-rolled page accumulator.
 *
 * It adopts the long-standing `userMemory:experiences` SWR key as its network
 * sync key, so other slices that already revalidate that list by its key root
 * (e.g. `base/action.ts` after an edit or a purge) keep working unchanged.
 */
export const experienceListResource = definePagedReplica<
  ExperienceListParams,
  ExperienceListItem,
  number,
  ExperienceListData
>({
  key: () => EXPERIENCE_LIST_KEY,
  name: 'experienceList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: ({ pageSize, q, sort }) => ({ pageSize, q: q || undefined, sort }),
  storage: 'indexedDB',
  syncKey: (params) => userMemoryKeys.experiences(params),
  version: 1,
});

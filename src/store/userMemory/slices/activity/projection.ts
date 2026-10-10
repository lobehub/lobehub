import { type ActivityListItem } from '@lobechat/types';

import { definePagedReplica, type ReplicaPagedData } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

/** Page size the memory activity list asks for when the caller does not name one. */
export const ACTIVITY_LIST_PAGE_SIZE = 12;

/** The activity list is never partitioned per container: one entry per scope. */
export const ACTIVITY_LIST_KEY = 'all';

/** Server-side ordering of the activity list (`ActivityListSort`). */
export type ActivityListSort = 'capturedAt' | 'startsAt';

/**
 * Query identity of one page set. `page` is NOT here — it is the paging cursor,
 * owned by the replica. `q` / `sort` / `status` / `types` change the rows the
 * server returns, so a projection taken under other values never paints.
 */
export interface ActivityListParams {
  pageSize: number;
  q?: string;
  sort?: ActivityListSort;
  status?: string[];
  types?: string[];
}

/**
 * The activity list view: the generic local-first paged data plus the query
 * descriptors it was fetched with, so the surface can tell whether the painted
 * page set still answers the request on screen.
 */
export interface ActivityListData extends ReplicaPagedData<ActivityListItem, number> {
  q?: string;
  sort?: ActivityListSort;
}

/**
 * The user-memory activity list (`userMemoryService.queryActivities`): a
 * local-first paged replica, so the memory page paints the persisted head page
 * on the first frame, the network confirms it, and "load more" appends further
 * pages through the engine instead of a hand-rolled page accumulator.
 *
 * It adopts the long-standing `userMemory:activities` SWR key as its network
 * sync key, so other slices that already revalidate that list by its key root
 * (e.g. `base/action.ts` after an edit or a purge) keep working unchanged.
 */
export const activityListResource = definePagedReplica<
  ActivityListParams,
  ActivityListItem,
  number,
  ActivityListData
>({
  key: () => ACTIVITY_LIST_KEY,
  name: 'activityList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: ({ pageSize, q, sort, status, types }) => ({
    pageSize,
    q: q || undefined,
    sort,
    status,
    types,
  }),
  storage: 'indexedDB',
  syncKey: (params) => userMemoryKeys.activities(params),
  version: 1,
});

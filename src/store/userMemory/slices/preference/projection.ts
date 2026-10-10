import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { definePagedReplica, type ReplicaPagedData } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

/** Page size the memory preference list asks for when the caller does not name one. */
export const PREFERENCE_LIST_PAGE_SIZE = 12;

/** The preference list is never partitioned per container: one entry per scope. */
export const PREFERENCE_LIST_KEY = 'all';

/** Server-side ordering of the preference list (`QueryUserMemoriesSort`). */
export type PreferenceListSort = 'capturedAt' | 'scorePriority';

/**
 * Query identity of one page set. `page` is NOT here — it is the paging cursor,
 * owned by the replica. `q` / `sort` change the rows the server returns, so a
 * projection taken under other values never paints.
 */
export interface PreferenceListParams {
  pageSize: number;
  q?: string;
  sort?: PreferenceListSort;
}

/**
 * The preference list view: the generic local-first paged data plus the query
 * descriptors it was fetched with, so the surface can tell whether the painted
 * page set still answers the request on screen.
 */
export interface PreferenceListData extends ReplicaPagedData<DisplayPreferenceMemory, number> {
  q?: string;
  sort?: PreferenceListSort;
}

/**
 * The user-memory preference list (`userMemories.queryMemories` with the
 * preference layer): a local-first paged replica, so the memory page paints the
 * persisted head page on the first frame, the network confirms it, and "load
 * more" appends further pages through the engine instead of a hand-rolled page
 * accumulator.
 *
 * It adopts the long-standing `userMemory:preferences` SWR key as its network
 * sync key, so other slices that already revalidate that list by its key root
 * (e.g. `base/action.ts` after an edit or a purge) keep working unchanged.
 */
export const preferenceListResource = definePagedReplica<
  PreferenceListParams,
  DisplayPreferenceMemory,
  number,
  PreferenceListData
>({
  key: () => PREFERENCE_LIST_KEY,
  name: 'preferenceList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: ({ pageSize, q, sort }) => ({ pageSize, q: q || undefined, sort }),
  storage: 'indexedDB',
  syncKey: (params) => userMemoryKeys.preferences(params),
  version: 1,
});

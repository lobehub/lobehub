import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { definePagedReplica, type ReplicaPagedData } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

/** Page size the memory context list asks for when the caller does not name one. */
export const CONTEXT_LIST_PAGE_SIZE = 12;

/** The context list is never partitioned per container: one entry per scope. */
export const CONTEXT_LIST_KEY = 'all';

/** Server-side ordering of the context list (`QueryUserMemoriesSort`). */
export type ContextListSort = 'capturedAt' | 'scoreImpact' | 'scoreUrgency';

/**
 * Query identity of one page set. `page` is NOT here — it is the paging cursor,
 * owned by the replica. `q` / `sort` change the rows the server returns, so a
 * projection taken under other values never paints.
 */
export interface ContextListParams {
  pageSize: number;
  q?: string;
  sort?: ContextListSort;
}

/**
 * The context list view: the generic local-first paged data plus the query
 * descriptors it was fetched with, so the surface can tell whether the painted
 * page set still answers the request on screen.
 */
export interface ContextListData extends ReplicaPagedData<DisplayContextMemory, number> {
  q?: string;
  sort?: ContextListSort;
}

/**
 * The user-memory context list (`userMemories.queryMemories` with the context
 * layer): a local-first paged replica, so the memory page paints the persisted
 * head page on the first frame, the network confirms it, and "load more"
 * appends further pages through the engine instead of a hand-rolled page
 * accumulator.
 *
 * It adopts the long-standing `userMemory:contexts` SWR key as its network
 * sync key, so other slices that already revalidate that list by its key root
 * (e.g. `base/action.ts` after an edit or a purge) keep working unchanged.
 */
export const contextListResource = definePagedReplica<
  ContextListParams,
  DisplayContextMemory,
  number,
  ContextListData
>({
  key: () => CONTEXT_LIST_KEY,
  name: 'contextList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: ({ pageSize, q, sort }) => ({ pageSize, q: q || undefined, sort }),
  storage: 'indexedDB',
  syncKey: (params) => userMemoryKeys.contexts(params),
  version: 1,
});

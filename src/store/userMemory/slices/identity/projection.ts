import { type IdentityListItem, type IdentityListSort } from '@lobechat/types';

import { definePagedReplica, defineReplica, type ReplicaPagedData } from '@/libs/replica';
import { userMemoryService } from '@/services/userMemory';

import { type IdentityForInjection } from '../../types';

/**
 * The identities page renders one global list, so its paged replica keeps a
 * single entry per scope and every reader finds the view under `identities`.
 */
export const IDENTITY_LIST_KEY = 'all';

/** Rows per page when the caller does not name one. */
export const DEFAULT_IDENTITY_LIST_PAGE_SIZE = 12;

/**
 * Query identity of one identities page: the server-side filters, the sort and
 * the page size. The window start is NOT here — it is the replica's paging
 * cursor (offset mode: the page index), which the engine owns and advances.
 */
export interface IdentityListParams {
  order?: 'asc' | 'desc';
  pageSize: number;
  q?: string;
  relationships?: string[];
  sort?: IdentityListSort;
  types?: string[];
}

/**
 * `identities` view: the generic local-first paged data plus the query
 * descriptors the page was fetched with, so the surface can tell whether the
 * painted rows still answer the request on screen. Paging bookkeeping
 * (`currentPage` / `hasMore` / `isLoadingMore`) comes from `ReplicaPagedData`.
 */
export interface IdentityListView extends ReplicaPagedData<IdentityListItem, number> {
  order?: 'asc' | 'desc';
  q?: string;
  relationships?: string[];
  sort?: IdentityListSort;
  types?: string[];
}

/** Bookkeeping half of {@link IdentityListView} (the rows live in `identities`). */
export type IdentityListMeta = Omit<IdentityListView, 'items'>;

/**
 * Whether a painted identity page still answers `params`. The view stores the
 * query it was fetched with, so a response for another query can never be read
 * as this one's answer.
 */
export const isIdentityQueryCurrent = (
  meta: IdentityListMeta | undefined,
  params: Pick<IdentityListParams, 'q' | 'types'>,
): boolean => {
  if (!meta) return false;
  const sameTypes =
    (meta.types?.length ?? 0) === (params.types?.length ?? 0) &&
    (meta.types ?? []).every((type) => (params.types ?? []).includes(type));

  return (meta.q || undefined) === (params.q || undefined) && sameTypes;
};

/**
 * The identities list (`userMemories.queryIdentities`): a local-first paged
 * replica. A reload paints the persisted head page on the first frame, the
 * network confirms it, and "load more" appends further pages through the
 * engine.
 *
 * Filters + sort + page size are the query identity: a projection taken under
 * another query never paints, and an un-loaded list never reads as an empty
 * one.
 *
 * Offset paging, cursor = page index (0 = head): the endpoint pages 1-based and
 * reports the real `total`, so "is there more" stays the server's answer.
 */
export const identityListResource = definePagedReplica<
  IdentityListParams,
  IdentityListItem,
  number,
  IdentityListView
>({
  fetchPage: async (params, cursor) => {
    const { pageSize, ...filters } = params;
    const result = await userMemoryService.queryIdentities({
      ...filters,
      page: (cursor ?? 0) + 1,
      pageSize,
    });

    return { items: result.items, total: result.total };
  },
  key: () => IDENTITY_LIST_KEY,
  name: 'identityList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: (params) => params,
  storage: 'indexedDB',
  version: 1,
});

/** The single entry of the injection-identities resource. */
export const GLOBAL_IDENTITIES_KEY = 'all';

/**
 * The caller's own identities, loaded at app init to inject into the chat
 * context (`userMemories.queryIdentitiesForInjection`). Read through
 * `identitySelectors.globalIdentities`; persisted so the injection survives a
 * reload from the local copy while the network confirms it.
 */
export const globalIdentitiesResource = defineReplica<
  Record<string, never>,
  IdentityForInjection[]
>({
  fetcher: () => userMemoryService.queryIdentitiesForInjection({ limit: 25 }),
  key: () => GLOBAL_IDENTITIES_KEY,
  name: 'globalIdentities',
  storage: 'indexedDB',
  version: 1,
});

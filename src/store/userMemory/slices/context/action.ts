import { type ContextMemorySimple, type UserMemoryItemSimple } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import { type MemoryListPageResult, MemoryQueryList } from '../utils/memoryQueryList';
import {
  CONTEXT_LIST_PAGE_SIZE,
  type ContextListData,
  type ContextListParams,
  contextListResource,
} from './projection';

const n = setNamespace('userMemory/context');

export interface ContextQueryParams extends Partial<ContextListParams> {
  page?: number;
}

/** Flat mirrors of one page set (`undefined` = the active query has no view yet). */
const mirrorsOf = (data: ContextListData | undefined): Partial<UserMemoryStore> =>
  data
    ? {
        contextListData: data,
        contexts: data.items,
        contextsHasMore: data.hasMore,
        contextsInit: true,
        contextsPage: data.currentPage + 1,
        contextsTotal: data.total ?? data.items.length,
      }
    : {
        contextListData: undefined,
        contexts: [],
        contextsHasMore: true,
        contextsInit: false,
        contextsPage: 1,
        contextsTotal: 0,
      };

/**
 * Flatten a `queryMemories` row into the display shape the context list
 * renders. The endpoint returns `{ memory, context }`; the row is merged in the
 * same order the previous slice did, with `source` pinned to `null`.
 */
const toDisplayContext = (item: UserMemoryItemSimple): DisplayContextMemory => {
  const { memory, context } = item as ContextMemorySimple;
  return { ...memory, ...context, source: null } as unknown as DisplayContextMemory;
};

type Setter = StoreSetter<UserMemoryStore>;
export const createContextSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ContextActionImpl(set, get, _api);

/**
 * The user-memory context list: one `MemoryQueryList` (shared with the other
 * offset-paged memory lists) behind the slice's long-standing action names.
 */
export class ContextActionImpl {
  readonly #list: MemoryQueryList<ContextListParams, DisplayContextMemory, ContextListData>;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#list = new MemoryQueryList({
      actionPrefix: n('contextList'),
      activeKeyField: 'contextListKey',
      entriesField: 'contextListEntries',
      fetchPage: async (params, page) => {
        const response = await userMemoryService.queryMemories({
          layer: LayersEnum.Context,
          page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
        });
        return { items: response.items.map(toDisplayContext), total: response.total };
      },
      get,
      mirror: mirrorsOf,
      queryFields: ({ q, sort }) => ({ contextsQuery: q || undefined, contextsSort: sort }),
      replicaField: 'contextListReplica',
      resource: contextListResource,
      rootKey: userMemoryKeys.contexts.root,
      set,
      useStore: (selector) => useUserMemoryStore(selector),
    });
  }

  /** Delete one context: optimistic, then the offset repair (see `OffsetListPager`). */
  deleteContext = (id: string): Promise<void> =>
    this.#list.delete(id, () => memoryCRUDService.deleteContext(id));

  /** Purge for "delete all memories" (every query, memory + IndexedDB). */
  internal_clearContextList = (user?: string): Promise<boolean> => this.#list.clear(user);

  /** Confirmed edit of one context in every loaded and persisted query. */
  internal_updateContextEntity = (
    id: string,
    fn: (item: DisplayContextMemory) => DisplayContextMemory,
  ): void => {
    this.#list.updateEntity(id, fn);
  };

  /** Append the next page of the query on screen. */
  loadMoreContexts = (): void => {
    void this.#list.loadMore();
  };

  /** Seed the persisted head page of a query before its route paints. */
  preHydrateContexts = (query?: Omit<ContextQueryParams, 'page' | 'pageSize'>): Promise<boolean> =>
    this.#list.preHydrate({ ...query, pageSize: CONTEXT_LIST_PAGE_SIZE, q: query?.q || undefined });

  /** Point the list at another search / sort (no page set is dropped). */
  resetContextsList = (params?: Omit<ContextQueryParams, 'page' | 'pageSize'>): void => {
    this.#list.select({ ...params, q: params?.q || undefined });
  };

  /** Fetch orchestration for the context list page (see `MemoryQueryList.useFetch`). */
  useFetchContexts = (
    params: ContextQueryParams,
  ): SWRResponse<MemoryListPageResult<DisplayContextMemory>> => {
    const { page: _page, ...query } = params;
    return this.#list.useFetch({
      ...query,
      pageSize: params.pageSize ?? CONTEXT_LIST_PAGE_SIZE,
      q: params.q || undefined,
    });
  };
}

export type ContextAction = Pick<ContextActionImpl, keyof ContextActionImpl>;

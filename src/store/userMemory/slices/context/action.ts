import { type ContextMemorySimple, type UserMemoryItemSimple } from '@lobechat/types';
import { useMemo } from 'react';
import { type SWRResponse } from 'swr';

import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { createReplicaSlice, type ReplicaLens, type ReplicaPageResult } from '@/libs/replica';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import {
  CONTEXT_LIST_KEY,
  CONTEXT_LIST_PAGE_SIZE,
  type ContextListData,
  type ContextListParams,
  contextListResource,
  type ContextListSort,
} from './projection';

const n = setNamespace('userMemory/context');

export interface ContextQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: ContextListSort;
}

/**
 * The context list keeps its long-standing flat fields (`contexts`,
 * `contextsTotal`, `contextsPage`, `contextsHasMore`, `contextsInit`) as derived
 * mirrors of the `contextList` replica view, so no consumer changes. The
 * canonical paged value lives in `contextListData` and is persisted to
 * IndexedDB by the replica engine.
 */
const contextListLens: ReplicaLens<UserMemoryStore, ContextListData> = {
  clear: () => ({
    contextListData: undefined,
    contexts: [],
    contextsHasMore: true,
    contextsInit: false,
    contextsPage: 1,
    contextsSearchLoading: undefined,
    contextsTotal: 0,
  }),
  get: (state) => state.contextListData,
  set: (_state, _key, data) => {
    if (!data) {
      return {
        contextListData: undefined,
        contexts: [],
        contextsHasMore: true,
        contextsInit: false,
        contextsPage: 1,
        contextsTotal: 0,
      };
    }
    return {
      contextListData: data,
      contexts: data.items,
      contextsHasMore: data.hasMore,
      contextsInit: true,
      contextsPage: data.currentPage + 1,
      // A landed page settles the search: clear the reset/error flags.
      contextsSearchError: undefined,
      contextsSearchLoading: false,
      contextsTotal: data.total ?? data.items.length,
    };
  },
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
 * The user-memory context list.
 *
 * Server state is one `@lobechat/replica` paged resource (`contextList`): the
 * persisted head page paints on the first frame and the network confirms it in
 * the background. The domain store exposes the same flat fields and the same
 * action surface it always has, backed by the replica view, so the memory
 * context page and its components are untouched.
 */
export class ContextActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #list;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#list = createReplicaSlice(contextListResource, {
      actionPrefix: n('contextList'),
      fetcher: (params, cursor) => this.#fetchPage(params, cursor),
      get,
      set,
      stateKey: 'contextListReplica',
      view: contextListLens,
      // Keep the painted page set self-describing (which query it answers).
      viewFields: ({ q, sort }) => ({ q: q || undefined, sort }),
    });
  }

  /** One page of the context list; `cursor` is the page index (0 = head). */
  #fetchPage = async (
    params: ContextListParams,
    cursor?: number,
  ): Promise<ReplicaPageResult<DisplayContextMemory, number>> => {
    const response = await userMemoryService.queryMemories({
      layer: LayersEnum.Context,
      page: (cursor ?? 0) + 1,
      pageSize: params.pageSize,
      q: params.q,
      sort: params.sort,
    });

    return { items: response.items.map(toDisplayContext), total: response.total };
  };

  /** Clear the surfaced error once a head page lands. */
  #clearListError = (): void => {
    if (this.#get().contextsSearchError === undefined) return;
    this.#set({ contextsSearchError: undefined }, false, n('contextList/clearError'));
  };

  /**
   * Surface a failed head/refresh fetch only when there is no settled content
   * to keep (initial load or a reset). A background refresh failure must not
   * replace an already-painted list with an error.
   */
  #surfaceListError = (error: unknown): void => {
    const { contextsInit, contextsSearchLoading } = this.#get();
    const surface = Boolean(contextsSearchLoading) || !contextsInit;
    this.#set(
      {
        contextsSearchError: surface ? error : undefined,
        contextsSearchLoading: false,
      },
      false,
      n('contextList/failList'),
    );
  };

  deleteContext = async (id: string): Promise<void> => {
    await memoryCRUDService.deleteContext(id);
    // Drop the row from the in-memory view and the persisted projection right
    // away; the list resyncs on its next revalidation (focus / remount).
    this.#list.updateEntity(id, () => undefined);
  };

  /**
   * Append the next page of the context list. The engine reads the loaded head
   * params, dedupes by id and keeps `hasMore` honest.
   */
  loadMoreContexts = (): void => {
    void this.#list.loadMore(CONTEXT_LIST_KEY);
  };

  /**
   * Drop the painted page set for a new search/sort so the previous query's rows
   * never show under the new one. A no-op when the query is unchanged, so a
   * remount keeps the in-memory + persisted view (the replica's first-frame
   * paint). The persisted rows are left alone.
   */
  resetContextsList = (params?: Omit<ContextQueryParams, 'page' | 'pageSize'>): void => {
    const { contextsQuery, contextsSort } = this.#get();
    const nextQuery = params?.q;
    const nextSort = params?.sort;
    if (contextsQuery === nextQuery && contextsSort === nextSort) return;

    this.#set(
      {
        contextsQuery: nextQuery,
        contextsSearchError: undefined,
        contextsSearchLoading: true,
        contextsSort: nextSort,
      },
      false,
      n('resetContextsList'),
    );
    this.#list.update(CONTEXT_LIST_KEY, () => undefined, { persist: false });
  };

  /**
   * Fetch orchestration for the memory context list. Returns an
   * `SWRResponse`-shaped result — `data` reads the replica view — so the
   * existing consumers (which pass it to `MemoryListBoundary`) are untouched;
   * the rows land in the store mirrors, never in this return value.
   */
  useFetchContexts = (params: ContextQueryParams): SWRResponse<any> => {
    const sync = this.#list.useSync(
      {
        pageSize: params.pageSize ?? CONTEXT_LIST_PAGE_SIZE,
        q: params.q,
        sort: params.sort,
      },
      {
        onError: (error) => this.#surfaceListError(error),
        onSuccess: () => this.#clearListError(),
      },
    );

    const view = useUserMemoryStore((state) => state.contextListData);
    const data = useMemo(
      () =>
        view
          ? {
              items: view.items,
              page: view.currentPage + 1,
              pageSize: view.pageSize,
              total: view.total ?? view.items.length,
            }
          : undefined,
      [view],
    );

    return {
      data,
      error: sync.error,
      isLoading: !data && (sync.isValidating || !sync.isHydrated),
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    } as unknown as SWRResponse<any>;
  };
}

export type ContextAction = Pick<ContextActionImpl, keyof ContextActionImpl>;

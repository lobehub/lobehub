import { type PreferenceMemorySimple, type UserMemoryItemSimple } from '@lobechat/types';
import { useMemo } from 'react';
import { type SWRResponse } from 'swr';

import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { createReplicaSlice, type ReplicaLens, type ReplicaPageResult } from '@/libs/replica';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import {
  PREFERENCE_LIST_KEY,
  PREFERENCE_LIST_PAGE_SIZE,
  type PreferenceListData,
  type PreferenceListParams,
  preferenceListResource,
  type PreferenceListSort,
} from './projection';

const n = setNamespace('userMemory/preference');

export interface PreferenceQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: PreferenceListSort;
}

/**
 * The preference list keeps its long-standing flat fields (`preferences`,
 * `preferencesTotal`, `preferencesPage`, `preferencesHasMore`,
 * `preferencesInit`) as derived mirrors of the `preferenceList` replica view, so
 * no consumer changes. The canonical paged value lives in `preferenceListData`
 * and is persisted to IndexedDB by the replica engine.
 */
const preferenceListLens: ReplicaLens<UserMemoryStore, PreferenceListData> = {
  clear: () => ({
    preferenceListData: undefined,
    preferences: [],
    preferencesHasMore: true,
    preferencesInit: false,
    preferencesPage: 1,
    preferencesSearchLoading: undefined,
    preferencesTotal: 0,
  }),
  get: (state) => state.preferenceListData,
  set: (_state, _key, data) => {
    if (!data) {
      return {
        preferenceListData: undefined,
        preferences: [],
        preferencesHasMore: true,
        preferencesInit: false,
        preferencesPage: 1,
        preferencesTotal: 0,
      };
    }
    return {
      preferenceListData: data,
      preferences: data.items,
      preferencesHasMore: data.hasMore,
      preferencesInit: true,
      preferencesPage: data.currentPage + 1,
      // A landed page settles the search: clear the reset/error flags.
      preferencesSearchError: undefined,
      preferencesSearchLoading: false,
      preferencesTotal: data.total ?? data.items.length,
    };
  },
};

/**
 * Flatten a `queryMemories` row into the display shape the preference list
 * renders. The endpoint returns `{ memory, preference }`; the row is merged in
 * the same order the previous slice did.
 */
const toDisplayPreference = (item: UserMemoryItemSimple): DisplayPreferenceMemory => {
  const { memory, preference } = item as PreferenceMemorySimple;
  return { ...memory, ...preference } as unknown as DisplayPreferenceMemory;
};

type Setter = StoreSetter<UserMemoryStore>;
export const createPreferenceSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new PreferenceActionImpl(set, get, _api);

/**
 * The user-memory preference list.
 *
 * Server state is one `@lobechat/replica` paged resource (`preferenceList`):
 * the persisted head page paints on the first frame and the network confirms it
 * in the background. The domain store exposes the same flat fields and the same
 * action surface it always has, backed by the replica view, so the memory
 * preference page and its components are untouched.
 */
export class PreferenceActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #list;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#list = createReplicaSlice(preferenceListResource, {
      actionPrefix: n('preferenceList'),
      fetcher: (params, cursor) => this.#fetchPage(params, cursor),
      get,
      set,
      stateKey: 'preferenceListReplica',
      view: preferenceListLens,
      // Keep the painted page set self-describing (which query it answers).
      viewFields: ({ q, sort }) => ({ q: q || undefined, sort }),
    });
  }

  /** One page of the preference list; `cursor` is the page index (0 = head). */
  #fetchPage = async (
    params: PreferenceListParams,
    cursor?: number,
  ): Promise<ReplicaPageResult<DisplayPreferenceMemory, number>> => {
    const response = await userMemoryService.queryMemories({
      layer: LayersEnum.Preference,
      page: (cursor ?? 0) + 1,
      pageSize: params.pageSize,
      q: params.q,
      sort: params.sort,
    });

    return { items: response.items.map(toDisplayPreference), total: response.total };
  };

  /** Clear the surfaced error once a head page lands. */
  #clearListError = (): void => {
    if (this.#get().preferencesSearchError === undefined) return;
    this.#set({ preferencesSearchError: undefined }, false, n('preferenceList/clearError'));
  };

  /**
   * Surface a failed head/refresh fetch only when there is no settled content
   * to keep (initial load or a reset). A background refresh failure must not
   * replace an already-painted list with an error.
   */
  #surfaceListError = (error: unknown): void => {
    const { preferencesInit, preferencesSearchLoading } = this.#get();
    const surface = Boolean(preferencesSearchLoading) || !preferencesInit;
    this.#set(
      {
        preferencesSearchError: surface ? error : undefined,
        preferencesSearchLoading: false,
      },
      false,
      n('preferenceList/failList'),
    );
  };

  deletePreference = async (id: string): Promise<void> => {
    await memoryCRUDService.deletePreference(id);
    // Drop the row from the in-memory view and the persisted projection right
    // away; the list resyncs on its next revalidation (focus / remount).
    this.#list.updateEntity(id, () => undefined);
  };

  /**
   * Append the next page of the preference list. The engine reads the loaded
   * head params, dedupes by id and keeps `hasMore` honest.
   */
  loadMorePreferences = (): void => {
    void this.#list.loadMore(PREFERENCE_LIST_KEY);
  };

  /**
   * Drop the painted page set for a new search/sort so the previous query's rows
   * never show under the new one. A no-op when the query is unchanged, so a
   * remount keeps the in-memory + persisted view (the replica's first-frame
   * paint). The persisted rows are left alone.
   */
  resetPreferencesList = (params?: Omit<PreferenceQueryParams, 'page' | 'pageSize'>): void => {
    const { preferencesQuery, preferencesSort } = this.#get();
    const nextQuery = params?.q;
    const nextSort = params?.sort;
    if (preferencesQuery === nextQuery && preferencesSort === nextSort) return;

    this.#set(
      {
        preferencesQuery: nextQuery,
        preferencesSearchError: undefined,
        preferencesSearchLoading: true,
        preferencesSort: nextSort,
      },
      false,
      n('resetPreferencesList'),
    );
    this.#list.update(PREFERENCE_LIST_KEY, () => undefined, { persist: false });
  };

  /**
   * Fetch orchestration for the memory preference list. Returns an
   * `SWRResponse`-shaped result — `data` reads the replica view — so the
   * existing consumers (which pass it to `MemoryListBoundary`) are untouched;
   * the rows land in the store mirrors, never in this return value.
   */
  useFetchPreferences = (params: PreferenceQueryParams): SWRResponse<any> => {
    const sync = this.#list.useSync(
      {
        pageSize: params.pageSize ?? PREFERENCE_LIST_PAGE_SIZE,
        q: params.q,
        sort: params.sort,
      },
      {
        onError: (error) => this.#surfaceListError(error),
        onSuccess: () => this.#clearListError(),
      },
    );

    const view = useUserMemoryStore((state) => state.preferenceListData);
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

export type PreferenceAction = Pick<PreferenceActionImpl, keyof PreferenceActionImpl>;

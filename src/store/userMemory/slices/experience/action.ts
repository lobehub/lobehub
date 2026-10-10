import { type ExperienceListItem, type ExperienceListResult } from '@lobechat/types';
import { useMemo } from 'react';
import { type SWRResponse } from 'swr';

import { createReplicaSlice, type ReplicaLens, type ReplicaPageResult } from '@/libs/replica';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import {
  EXPERIENCE_LIST_KEY,
  EXPERIENCE_LIST_PAGE_SIZE,
  type ExperienceListData,
  type ExperienceListParams,
  experienceListResource,
  type ExperienceListSort,
} from './projection';

const n = setNamespace('userMemory/experience');

export interface ExperienceQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: ExperienceListSort;
}

/**
 * The experience list keeps its long-standing flat fields (`experiences`,
 * `experiencesTotal`, `experiencesPage`, `experiencesHasMore`, `experiencesInit`)
 * as derived mirrors of the `experienceList` replica view, so no consumer
 * changes. The canonical paged value lives in `experienceListData` and is
 * persisted to IndexedDB by the replica engine.
 */
const experienceListLens: ReplicaLens<UserMemoryStore, ExperienceListData> = {
  clear: () => ({
    experiences: [],
    experiencesHasMore: true,
    experiencesInit: false,
    experiencesPage: 1,
    experiencesSearchLoading: undefined,
    experiencesTotal: 0,
    experienceListData: undefined,
  }),
  get: (state) => state.experienceListData,
  set: (_state, _key, data) => {
    if (!data) {
      return {
        experiences: [],
        experiencesHasMore: true,
        experiencesInit: false,
        experiencesPage: 1,
        experiencesTotal: 0,
        experienceListData: undefined,
      };
    }
    return {
      experiences: data.items,
      experiencesHasMore: data.hasMore,
      experiencesInit: true,
      experiencesPage: data.currentPage + 1,
      // A landed page settles the search: clear the reset/error flags.
      experiencesSearchError: undefined,
      experiencesSearchLoading: false,
      experiencesTotal: data.total ?? data.items.length,
      experienceListData: data,
    };
  },
};

type Setter = StoreSetter<UserMemoryStore>;
export const createExperienceSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ExperienceActionImpl(set, get, _api);

/**
 * The user-memory experience list.
 *
 * Server state is one `@lobechat/replica` paged resource (`experienceList`): the
 * persisted head page paints on the first frame and the network confirms it in
 * the background. The domain store exposes the same flat fields and the same
 * action surface it always has, backed by the replica view, so the memory
 * experience page and its components are untouched.
 */
export class ExperienceActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #list;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#list = createReplicaSlice(experienceListResource, {
      actionPrefix: n('experienceList'),
      fetcher: (params, cursor) => this.#fetchPage(params, cursor),
      get,
      set,
      stateKey: 'experienceListReplica',
      view: experienceListLens,
      // Keep the painted page set self-describing (which query it answers).
      viewFields: ({ q, sort }) => ({ q: q || undefined, sort }),
    });
  }

  /** One page of the experience list; `cursor` is the page index (0 = head). */
  #fetchPage = async (
    params: ExperienceListParams,
    cursor?: number,
  ): Promise<ReplicaPageResult<ExperienceListItem, number>> => {
    const response = await userMemoryService.queryExperiences({
      page: (cursor ?? 0) + 1,
      pageSize: params.pageSize,
      q: params.q,
      sort: params.sort,
    });

    return { items: response.items, total: response.total };
  };

  /** Clear the surfaced error once a head page lands. */
  #clearListError = (): void => {
    if (this.#get().experiencesSearchError === undefined) return;
    this.#set({ experiencesSearchError: undefined }, false, n('experiences/clearError'));
  };

  /**
   * Surface a failed head/refresh fetch only when there is no settled content
   * to keep (initial load or a reset). A background refresh failure must not
   * replace an already-painted list with an error.
   */
  #surfaceListError = (error: unknown): void => {
    const { experiencesInit, experiencesSearchLoading } = this.#get();
    const surface = Boolean(experiencesSearchLoading) || !experiencesInit;
    this.#set(
      {
        experiencesSearchError: surface ? error : undefined,
        experiencesSearchLoading: false,
      },
      false,
      n('experiences/failList'),
    );
  };

  deleteExperience = async (id: string): Promise<void> => {
    await memoryCRUDService.deleteExperience(id);
    // Drop the row from the in-memory view and the persisted projection right
    // away; the list resyncs on its next revalidation (focus / remount).
    this.#list.updateEntity(id, () => undefined);
  };

  /**
   * Append the next page of the experience list. The engine reads the loaded
   * head params, dedupes by id and keeps `hasMore` honest.
   */
  loadMoreExperiences = (): void => {
    void this.#list.loadMore(EXPERIENCE_LIST_KEY);
  };

  /**
   * Drop the painted page set for a new search/sort so the previous query's rows
   * never show under the new one. A no-op when the query is unchanged, so a
   * remount keeps the in-memory + persisted view (the replica's first-frame
   * paint). The persisted rows are left alone.
   */
  resetExperiencesList = (params?: Omit<ExperienceQueryParams, 'page' | 'pageSize'>): void => {
    const { experiencesQuery, experiencesSort } = this.#get();
    const nextQuery = params?.q;
    const nextSort = params?.sort;
    if (experiencesQuery === nextQuery && experiencesSort === nextSort) return;

    this.#set(
      {
        experiencesQuery: nextQuery,
        experiencesSearchError: undefined,
        experiencesSearchLoading: true,
        experiencesSort: nextSort,
      },
      false,
      n('resetExperiencesList'),
    );
    this.#list.update(EXPERIENCE_LIST_KEY, () => undefined, { persist: false });
  };

  /**
   * Fetch orchestration for the memory experience list. Returns an
   * `SWRResponse`-shaped result — `data` reads the replica view — so the
   * existing consumers (which pass it to `MemoryListBoundary`) are untouched;
   * the rows land in the store mirrors, never in this return value.
   */
  useFetchExperiences = (params: ExperienceQueryParams): SWRResponse<ExperienceListResult> => {
    const sync = this.#list.useSync(
      {
        pageSize: params.pageSize ?? EXPERIENCE_LIST_PAGE_SIZE,
        q: params.q,
        sort: params.sort,
      },
      {
        onError: (error) => this.#surfaceListError(error),
        onSuccess: () => this.#clearListError(),
      },
    );

    const view = useUserMemoryStore((state) => state.experienceListData);
    const data = useMemo<ExperienceListResult | undefined>(
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
    } as unknown as SWRResponse<ExperienceListResult>;
  };
}

export type ExperienceAction = Pick<ExperienceActionImpl, keyof ExperienceActionImpl>;

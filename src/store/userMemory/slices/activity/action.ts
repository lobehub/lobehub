import { type ActivityListItem, type ActivityListResult } from '@lobechat/types';
import { useMemo } from 'react';
import { type SWRResponse } from 'swr';

import { createReplicaSlice, type ReplicaLens, type ReplicaPageResult } from '@/libs/replica';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import {
  ACTIVITY_LIST_KEY,
  ACTIVITY_LIST_PAGE_SIZE,
  type ActivityListData,
  type ActivityListParams,
  activityListResource,
  type ActivityListSort,
} from './projection';

const n = setNamespace('userMemory/activity');

export interface ActivityQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: ActivityListSort;
  status?: string[];
  types?: string[];
}

/**
 * The activity list keeps its long-standing flat fields (`activities`,
 * `activitiesTotal`, `activitiesPage`, `activitiesHasMore`, `activitiesInit`)
 * as derived mirrors of the `activityList` replica view, so no consumer changes.
 * The canonical paged value lives in `activityListData` and is persisted to
 * IndexedDB by the replica engine.
 */
const activityListLens: ReplicaLens<UserMemoryStore, ActivityListData> = {
  clear: () => ({
    activities: [],
    activitiesHasMore: true,
    activitiesInit: false,
    activitiesPage: 1,
    activitiesSearchLoading: undefined,
    activitiesTotal: 0,
    activityListData: undefined,
  }),
  get: (state) => state.activityListData,
  set: (_state, _key, data) => {
    if (!data) {
      return {
        activities: [],
        activitiesHasMore: true,
        activitiesInit: false,
        activitiesPage: 1,
        activitiesTotal: 0,
        activityListData: undefined,
      };
    }
    return {
      activities: data.items,
      activitiesHasMore: data.hasMore,
      activitiesInit: true,
      activitiesPage: data.currentPage + 1,
      // A landed page settles the search: clear the reset/error flags.
      activitiesSearchError: undefined,
      activitiesSearchLoading: false,
      activitiesTotal: data.total ?? data.items.length,
      activityListData: data,
    };
  },
};

type Setter = StoreSetter<UserMemoryStore>;
export const createActivitySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ActivityActionImpl(set, get, _api);

/**
 * The user-memory activity list.
 *
 * Server state is one `@lobechat/replica` paged resource (`activityList`): the
 * persisted head page paints on the first frame and the network confirms it in
 * the background. The domain store exposes the same flat fields and the same
 * action surface it always has, backed by the replica view, so the memory
 * activity page and its components are untouched.
 */
export class ActivityActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #list;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#list = createReplicaSlice(activityListResource, {
      actionPrefix: n('activityList'),
      fetcher: (params, cursor) => this.#fetchPage(params, cursor),
      get,
      set,
      stateKey: 'activityListReplica',
      view: activityListLens,
      // Keep the painted page set self-describing (which query it answers).
      viewFields: ({ q, sort }) => ({ q: q || undefined, sort }),
    });
  }

  /** One page of the activity list; `cursor` is the page index (0 = head). */
  #fetchPage = async (
    params: ActivityListParams,
    cursor?: number,
  ): Promise<ReplicaPageResult<ActivityListItem, number>> => {
    const response = await userMemoryService.queryActivities({
      page: (cursor ?? 0) + 1,
      pageSize: params.pageSize,
      q: params.q,
      sort: params.sort,
      status: params.status,
      types: params.types,
    });

    return { items: response.items, total: response.total };
  };

  /** Clear the surfaced error once a head page lands. */
  #clearListError = (): void => {
    if (this.#get().activitiesSearchError === undefined) return;
    this.#set({ activitiesSearchError: undefined }, false, n('activities/clearError'));
  };

  /**
   * Surface a failed head/refresh fetch only when there is no settled content
   * to keep (initial load or a reset). A background refresh failure must not
   * replace an already-painted list with an error.
   */
  #surfaceListError = (error: unknown): void => {
    const { activitiesInit, activitiesSearchLoading } = this.#get();
    const surface = Boolean(activitiesSearchLoading) || !activitiesInit;
    this.#set(
      {
        activitiesSearchError: surface ? error : undefined,
        activitiesSearchLoading: false,
      },
      false,
      n('activities/failList'),
    );
  };

  deleteActivity = async (id: string): Promise<void> => {
    await memoryCRUDService.deleteActivity(id);
    // Drop the row from the in-memory view and the persisted projection right
    // away; the list resyncs on its next revalidation (focus / remount).
    this.#list.updateEntity(id, () => undefined);
  };

  /**
   * Append the next page of the activity list. The engine reads the loaded head
   * params, dedupes by id and keeps `hasMore` honest.
   */
  loadMoreActivities = (): void => {
    void this.#list.loadMore(ACTIVITY_LIST_KEY);
  };

  /**
   * Drop the painted page set for a new search/sort so the previous query's rows
   * never show under the new one. A no-op when the query is unchanged, so a
   * remount keeps the in-memory + persisted view (the replica's first-frame
   * paint). The persisted rows are left alone.
   */
  resetActivitiesList = (params?: Omit<ActivityQueryParams, 'page' | 'pageSize'>): void => {
    const { activitiesQuery, activitiesSort } = this.#get();
    const nextQuery = params?.q;
    const nextSort = params?.sort;
    if (activitiesQuery === nextQuery && activitiesSort === nextSort) return;

    this.#set(
      {
        activitiesQuery: nextQuery,
        activitiesSearchError: undefined,
        activitiesSearchLoading: true,
        activitiesSort: nextSort,
      },
      false,
      n('resetActivitiesList'),
    );
    this.#list.update(ACTIVITY_LIST_KEY, () => undefined, { persist: false });
  };

  /**
   * Fetch orchestration for the memory activity list. Returns an
   * `SWRResponse`-shaped result — `data` reads the replica view — so the
   * existing consumers (which pass it to `MemoryListBoundary`) are untouched;
   * the rows land in the store mirrors, never in this return value.
   */
  useFetchActivities = (params: ActivityQueryParams): SWRResponse<ActivityListResult> => {
    const sync = this.#list.useSync(
      {
        pageSize: params.pageSize ?? ACTIVITY_LIST_PAGE_SIZE,
        q: params.q,
        sort: params.sort,
        status: params.status,
        types: params.types,
      },
      {
        onError: (error) => this.#surfaceListError(error),
        onSuccess: () => this.#clearListError(),
      },
    );

    const view = useUserMemoryStore((state) => state.activityListData);
    const data = useMemo<ActivityListResult | undefined>(
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
    } as unknown as SWRResponse<ActivityListResult>;
  };
}

export type ActivityAction = Pick<ActivityActionImpl, keyof ActivityActionImpl>;

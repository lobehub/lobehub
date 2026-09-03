import { type ActivityListResult } from '@lobechat/types';
import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import { useEffect } from 'react';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import { isMemoryListRequestCurrent } from '../utils/isMemoryListRequestCurrent';
import { shouldSurfaceMemoryListError } from '../utils/shouldSurfaceMemoryListError';

const n = setNamespace('userMemory/activity');

export interface ActivityQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'startsAt';
  status?: string[];
  types?: string[];
}

type ActivityListRequest = ActivityQueryParams & { page: number };

type Setter = StoreSetter<UserMemoryStore>;
export const createActivitySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ActivityActionImpl(set, get, _api);

export class ActivityActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  deleteActivity = async (id: string): Promise<void> => {
    await memoryCRUDService.deleteActivity(id);
    this.#get().resetActivitiesList({
      q: this.#get().activitiesQuery,
      sort: this.#get().activitiesSort,
    });
  };

  loadMoreActivities = (): void => {
    const { activitiesPage, activitiesTotal, activities } = this.#get();
    if (activities.length < (activitiesTotal || 0)) {
      this.#set(
        produce((draft) => {
          draft.activitiesPage = activitiesPage + 1;
        }),
        false,
        n('loadMoreActivities'),
      );
    }
  };

  internal_acceptActivitiesList = (
    data: ActivityListResult,
    request: ActivityListRequest,
  ): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        {
          page: state.activitiesPage,
          q: state.activitiesQuery,
          sort: state.activitiesSort,
        },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    this.#set(
      produce((draft) => {
        draft.activitiesSearchError = undefined;
        draft.activitiesSearchLoading = false;
        draft.activitiesTotal = data.total;

        if (!draft.activitiesInit) {
          draft.activitiesInit = true;
        }

        if (request.page === 1) {
          draft.activities = uniqBy(data.items, 'id');
        } else {
          draft.activities = uniqBy([...draft.activities, ...data.items], 'id');
        }

        draft.activitiesHasMore = data.items.length >= (request.pageSize || 20);
      }),
      false,
      n('internal_acceptActivitiesList'),
    );
  };

  internal_failActivitiesList = (error: unknown, request: ActivityListRequest): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        {
          page: state.activitiesPage,
          q: state.activitiesQuery,
          sort: state.activitiesSort,
        },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    const shouldSurfaceError = shouldSurfaceMemoryListError({
      initialized: state.activitiesInit,
      page: request.page,
      resetting: state.activitiesSearchLoading,
    });

    this.#set(
      produce((draft) => {
        if (shouldSurfaceError) draft.activitiesSearchError = error;
        draft.activitiesSearchLoading = false;
      }),
      false,
      n('internal_failActivitiesList'),
    );
  };

  resetActivitiesList = (params?: Omit<ActivityQueryParams, 'page' | 'pageSize'>): void => {
    this.#set(
      produce((draft) => {
        draft.activities = [];
        draft.activitiesPage = 1;
        draft.activitiesQuery = params?.q;
        draft.activitiesSearchError = undefined;
        draft.activitiesSearchLoading = true;
        draft.activitiesSort = params?.sort;
      }),
      false,
      n('resetActivitiesList'),
    );
  };

  /**
   * Hydrate the store from SWR's rendered state because deduped cache hits do not invoke SWR's
   * request lifecycle callbacks.
   */
  useFetchActivities = (params: ActivityQueryParams): SWRResponse<ActivityListResult> => {
    const page = params.page ?? 1;
    const response = useSWR(
      userMemoryKeys.activities(params),
      async () => {
        return userMemoryService.queryActivities({
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
          status: params.status,
          types: params.types,
        });
      },
      {
        revalidateOnFocus: false,
      },
    );

    useEffect(() => {
      if (response.data !== undefined)
        this.internal_acceptActivitiesList(response.data, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.data]);

    useEffect(() => {
      if (response.error !== undefined)
        this.internal_failActivitiesList(response.error, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.error]);

    return response;
  };
}

export type ActivityAction = Pick<ActivityActionImpl, keyof ActivityActionImpl>;

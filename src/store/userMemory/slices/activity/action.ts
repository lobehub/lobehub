import type { ActivityListResult } from '@lobechat/types';
import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { userMemoryService } from '@/services/userMemory';
import { memoryCRUDService } from '@/services/userMemory/index';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/activity');

export interface ActivityQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'startsAt';
  status?: string[];
   types?: string[];
}

export interface ActivityAction {
  deleteActivity: (id: string) => Promise<void>;
  loadMoreActivities: () => void;
  resetActivitiesList: (params?: Omit<ActivityQueryParams, 'page' | 'pageSize'>) => void;
  useFetchActivities: (params: ActivityQueryParams) => SWRResponse<ActivityListResult>;
}

export const createActivitySlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  ActivityAction
> = (set, get) => ({
  deleteActivity: async (id) => {
    await memoryCRUDService.deleteActivity(id);
    get().resetActivitiesList({ q: get().activitiesQuery, sort: get().activitiesSort });
  },

  loadMoreActivities: () => {
    const { activitiesPage, activitiesTotal, activities } = get();
    if (activities.length < (activitiesTotal || 0)) {
      set(
        produce((draft) => {
          draft.activitiesPage = activitiesPage + 1;
        }),
        false,
        n('loadMoreActivities'),
      );
    }
  },

  resetActivitiesList: (params) => {
    set(
      produce((draft) => {
        draft.activities = [];
        draft.activitiesPage = 1;
        draft.activitiesQuery = params?.q;
        draft.activitiesSearchLoading = true;
        draft.activitiesSort = params?.sort;
      }),
      false,
      n('resetActivitiesList'),
    );
  },

  useFetchActivities: (params) => {
    const swrKeyParts = [
      'useFetchActivities',
      params.page,
      params.pageSize,
      params.q,
      params.sort,
      params.status?.join(',') ?? '',
      params.types?.join(',') ?? '',
    ];
    const swrKey = swrKeyParts
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join('-');
    const page = params.page ?? 1;

    return useSWR(
      swrKey,
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
        onSuccess(data: ActivityListResult) {
          set(
            produce((draft) => {
              draft.activitiesSearchLoading = false;
              draft.activitiesTotal = data.total;

              if (!draft.activitiesInit) {
                draft.activitiesInit = true;
              }

              if (page === 1) {
                draft.activities = uniqBy(data.items, 'id');
              } else {
                draft.activities = uniqBy([...draft.activities, ...data.items], 'id');
              }

              draft.activitiesHasMore = data.items.length >= (params.pageSize || 20);
            }),
            false,
            n('useFetchActivities/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
});

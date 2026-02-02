import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { userMemoryService } from '@/services/userMemory';
import { memoryCRUDService } from '@/services/userMemory/index';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/preference');

export interface PreferenceQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'scorePriority';
}

export interface PreferenceAction {
  deletePreference: (id: string) => Promise<void>;
  loadMorePreferences: () => void;
  resetPreferencesList: (params?: Omit<PreferenceQueryParams, 'page' | 'pageSize'>) => void;
  useFetchPreferences: (params: PreferenceQueryParams) => SWRResponse<any>;
}

export const createPreferenceSlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  PreferenceAction
> = (set, get) => ({
  deletePreference: async (id) => {
    await memoryCRUDService.deletePreference(id);
    // Reset list to refresh
    get().resetPreferencesList({ q: get().preferencesQuery, sort: get().preferencesSort });
  },

  loadMorePreferences: () => {
    const { preferencesPage, preferencesTotal, preferences } = get();
    if (preferences.length < (preferencesTotal || 0)) {
      set(
        produce((draft) => {
          draft.preferencesPage = preferencesPage + 1;
        }),
        false,
        n('loadMorePreferences'),
      );
    }
  },

  resetPreferencesList: (params) => {
    set(
      produce((draft) => {
        draft.preferences = [];
        draft.preferencesPage = 1;
        draft.preferencesQuery = params?.q;
        draft.preferencesSearchLoading = true;
        draft.preferencesSort = params?.sort;
      }),
      false,
      n('resetPreferencesList'),
    );
  },

  useFetchPreferences: (params) => {
    const swrKeyParts = [
      'useFetchPreferences',
      params.page,
      params.pageSize,
      params.q,
      params.sort,
    ];
    const swrKey = swrKeyParts
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join('-');
    const page = params.page ?? 1;

    return useSWR(
      swrKey,
      async () => {
        const result = await userMemoryService.queryMemories({
          layer: LayersEnum.Preference,
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
        });

        return result;
      },
      {
        onSuccess(data: any) {
          set(
            produce((draft) => {
              draft.preferencesSearchLoading = false;

              // Set basic information
              if (!draft.preferencesInit) {
                draft.preferencesInit = true;
                draft.preferencesTotal = data.total;
              }

              // Transform data structure
              const transformedItems = data.items.map((item: any) => ({
                ...item.memory,
                ...item.preference,
              }));

              // Accumulate data logic
              if (page === 1) {
                // First page, set directly
                draft.preferences = uniqBy(transformedItems, 'id');
              } else {
                // Subsequent pages, accumulate data
                draft.preferences = uniqBy([...draft.preferences, ...transformedItems], 'id');
              }

              // Update hasMore
              draft.preferencesHasMore = data.items.length >= (params.pageSize || 20);
            }),
            false,
            n('useFetchPreferences/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
});

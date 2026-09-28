import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import { useEffect } from 'react';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import { isMemoryListRequestCurrent } from '../utils/isMemoryListRequestCurrent';
import { shouldSurfaceMemoryListError } from '../utils/shouldSurfaceMemoryListError';

const n = setNamespace('userMemory/preference');

export interface PreferenceQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'scorePriority';
}

type PreferenceListRequest = PreferenceQueryParams & { page: number };

type Setter = StoreSetter<UserMemoryStore>;
export const createPreferenceSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new PreferenceActionImpl(set, get, _api);

export class PreferenceActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  deletePreference = async (id: string): Promise<void> => {
    await memoryCRUDService.deletePreference(id);
    // Reset list to refresh
    this.#get().resetPreferencesList({
      q: this.#get().preferencesQuery,
      sort: this.#get().preferencesSort,
    });
  };

  loadMorePreferences = (): void => {
    const { preferencesPage, preferencesTotal, preferences } = this.#get();
    if (preferences.length < (preferencesTotal || 0)) {
      this.#set(
        produce((draft) => {
          draft.preferencesPage = preferencesPage + 1;
        }),
        false,
        n('loadMorePreferences'),
      );
    }
  };

  internal_acceptPreferencesList = (data: any, request: PreferenceListRequest): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        {
          page: state.preferencesPage,
          q: state.preferencesQuery,
          sort: state.preferencesSort,
        },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    this.#set(
      produce((draft) => {
        draft.preferencesSearchError = undefined;
        draft.preferencesSearchLoading = false;
        draft.preferencesTotal = data.total;

        if (!draft.preferencesInit) {
          draft.preferencesInit = true;
        }

        const transformedItems: DisplayPreferenceMemory[] = data.items.map((item: any) => ({
          ...item.memory,
          ...item.preference,
        }));

        if (request.page === 1) {
          draft.preferences = uniqBy(transformedItems, 'id');
        } else {
          draft.preferences = uniqBy([...draft.preferences, ...transformedItems], 'id');
        }

        draft.preferencesHasMore = data.items.length >= (request.pageSize || 20);
      }),
      false,
      n('internal_acceptPreferencesList'),
    );
  };

  internal_failPreferencesList = (error: unknown, request: PreferenceListRequest): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        {
          page: state.preferencesPage,
          q: state.preferencesQuery,
          sort: state.preferencesSort,
        },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    const shouldSurfaceError = shouldSurfaceMemoryListError({
      initialized: state.preferencesInit,
      page: request.page,
      resetting: state.preferencesSearchLoading,
    });

    this.#set(
      produce((draft) => {
        if (shouldSurfaceError) draft.preferencesSearchError = error;
        draft.preferencesSearchLoading = false;
      }),
      false,
      n('internal_failPreferencesList'),
    );
  };

  resetPreferencesList = (params?: Omit<PreferenceQueryParams, 'page' | 'pageSize'>): void => {
    this.#set(
      produce((draft) => {
        draft.preferences = [];
        draft.preferencesPage = 1;
        draft.preferencesQuery = params?.q;
        draft.preferencesSearchError = undefined;
        draft.preferencesSearchLoading = true;
        draft.preferencesSort = params?.sort;
      }),
      false,
      n('resetPreferencesList'),
    );
  };

  /**
   * Hydrate the store from SWR's rendered state because deduped cache hits do not invoke SWR's
   * request lifecycle callbacks.
   */
  useFetchPreferences = (params: PreferenceQueryParams): SWRResponse<any> => {
    const page = params.page ?? 1;
    const response = useSWR(
      userMemoryKeys.preferences(params),
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
        revalidateOnFocus: false,
      },
    );

    useEffect(() => {
      if (response.data !== undefined)
        this.internal_acceptPreferencesList(response.data, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.data]);

    useEffect(() => {
      if (response.error !== undefined)
        this.internal_failPreferencesList(response.error, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.error]);

    return response;
  };
}

export type PreferenceAction = Pick<PreferenceActionImpl, keyof PreferenceActionImpl>;

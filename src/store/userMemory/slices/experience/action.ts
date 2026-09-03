import { type ExperienceListResult } from '@lobechat/types';
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

const n = setNamespace('userMemory/experience');

export interface ExperienceQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'scoreConfidence';
}

type ExperienceListRequest = ExperienceQueryParams & { page: number };

type Setter = StoreSetter<UserMemoryStore>;
export const createExperienceSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ExperienceActionImpl(set, get, _api);

export class ExperienceActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  deleteExperience = async (id: string): Promise<void> => {
    await memoryCRUDService.deleteExperience(id);
    // Reset list to refresh
    this.#get().resetExperiencesList({
      q: this.#get().experiencesQuery,
      sort: this.#get().experiencesSort,
    });
  };

  loadMoreExperiences = (): void => {
    const { experiencesPage, experiencesTotal, experiences } = this.#get();
    if (experiences.length < (experiencesTotal || 0)) {
      this.#set(
        produce((draft) => {
          draft.experiencesPage = experiencesPage + 1;
        }),
        false,
        n('loadMoreExperiences'),
      );
    }
  };

  internal_acceptExperiencesList = (
    data: ExperienceListResult,
    request: ExperienceListRequest,
  ): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        {
          page: state.experiencesPage,
          q: state.experiencesQuery,
          sort: state.experiencesSort,
        },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    this.#set(
      produce((draft) => {
        draft.experiencesSearchError = undefined;
        draft.experiencesSearchLoading = false;
        draft.experiencesTotal = data.total;

        if (!draft.experiencesInit) {
          draft.experiencesInit = true;
        }

        if (request.page === 1) {
          draft.experiences = uniqBy(data.items, 'id');
        } else {
          draft.experiences = uniqBy([...draft.experiences, ...data.items], 'id');
        }

        draft.experiencesHasMore = data.items.length >= (request.pageSize || 20);
      }),
      false,
      n('internal_acceptExperiencesList'),
    );
  };

  internal_failExperiencesList = (error: unknown, request: ExperienceListRequest): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        {
          page: state.experiencesPage,
          q: state.experiencesQuery,
          sort: state.experiencesSort,
        },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    const shouldSurfaceError = shouldSurfaceMemoryListError({
      initialized: state.experiencesInit,
      page: request.page,
      resetting: state.experiencesSearchLoading,
    });

    this.#set(
      produce((draft) => {
        if (shouldSurfaceError) draft.experiencesSearchError = error;
        draft.experiencesSearchLoading = false;
      }),
      false,
      n('internal_failExperiencesList'),
    );
  };

  resetExperiencesList = (params?: Omit<ExperienceQueryParams, 'page' | 'pageSize'>): void => {
    this.#set(
      produce((draft) => {
        draft.experiences = [];
        draft.experiencesPage = 1;
        draft.experiencesQuery = params?.q;
        draft.experiencesSearchError = undefined;
        draft.experiencesSearchLoading = true;
        draft.experiencesSort = params?.sort;
      }),
      false,
      n('resetExperiencesList'),
    );
  };

  /**
   * Hydrate the store from SWR's rendered state because deduped cache hits do not invoke SWR's
   * request lifecycle callbacks.
   */
  useFetchExperiences = (params: ExperienceQueryParams): SWRResponse<ExperienceListResult> => {
    const page = params.page ?? 1;
    const response = useSWR(
      userMemoryKeys.experiences(params),
      async () => {
        // Use the new dedicated queryExperiences API
        return userMemoryService.queryExperiences({
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
        });
      },
      {
        revalidateOnFocus: false,
      },
    );

    useEffect(() => {
      if (response.data !== undefined)
        this.internal_acceptExperiencesList(response.data, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.data]);

    useEffect(() => {
      if (response.error !== undefined)
        this.internal_failExperiencesList(response.error, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.error]);

    return response;
  };
}

export type ExperienceAction = Pick<ExperienceActionImpl, keyof ExperienceActionImpl>;

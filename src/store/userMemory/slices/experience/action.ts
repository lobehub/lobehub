import type { ExperienceListResult } from '@lobechat/types';
import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { userMemoryService } from '@/services/userMemory';
import { memoryCRUDService } from '@/services/userMemory/index';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/experience');

export interface ExperienceQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'scoreConfidence';
}

export interface ExperienceAction {
  deleteExperience: (id: string) => Promise<void>;
  loadMoreExperiences: () => void;
  resetExperiencesList: (params?: Omit<ExperienceQueryParams, 'page' | 'pageSize'>) => void;
  useFetchExperiences: (params: ExperienceQueryParams) => SWRResponse<ExperienceListResult>;
}

export const createExperienceSlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  ExperienceAction
> = (set, get) => ({
  deleteExperience: async (id) => {
    await memoryCRUDService.deleteExperience(id);
    // Reset list to refresh
    get().resetExperiencesList({ q: get().experiencesQuery, sort: get().experiencesSort });
  },

  loadMoreExperiences: () => {
    const { experiencesPage, experiencesTotal, experiences } = get();
    if (experiences.length < (experiencesTotal || 0)) {
      set(
        produce((draft) => {
          draft.experiencesPage = experiencesPage + 1;
        }),
        false,
        n('loadMoreExperiences'),
      );
    }
  },

  resetExperiencesList: (params) => {
    set(
      produce((draft) => {
        draft.experiences = [];
        draft.experiencesPage = 1;
        draft.experiencesQuery = params?.q;
        draft.experiencesSearchLoading = true;
        draft.experiencesSort = params?.sort;
      }),
      false,
      n('resetExperiencesList'),
    );
  },

  useFetchExperiences: (params) => {
    const swrKeyParts = [
      'useFetchExperiences',
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
        // Use the new dedicated queryExperiences API
        return userMemoryService.queryExperiences({
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
        });
      },
      {
        onSuccess(data: ExperienceListResult) {
          set(
            produce((draft) => {
              draft.experiencesSearchLoading = false;
              draft.experiencesTotal = data.total;

              if (!draft.experiencesInit) {
                draft.experiencesInit = true;
              }

              // Backend now returns flat structure directly, no transformation needed
              if (page === 1) {
                draft.experiences = uniqBy(data.items, 'id');
              } else {
                draft.experiences = uniqBy([...draft.experiences, ...data.items], 'id');
              }

              draft.experiencesHasMore = data.items.length >= (params.pageSize || 20);
            }),
            false,
            n('useFetchExperiences/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
});

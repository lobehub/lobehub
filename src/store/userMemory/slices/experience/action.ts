import { type ExperienceListResult } from '@lobechat/types';
import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/experience');

export interface ExperienceQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'scoreConfidence';
}

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

  resetExperiencesList = (params?: Omit<ExperienceQueryParams, 'page' | 'pageSize'>): void => {
    this.#set(
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
  };

  useFetchExperiences = (params: ExperienceQueryParams): SWRResponse<ExperienceListResult> => {
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
        onSuccess: (data: ExperienceListResult) => {
          this.#set(
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
  };
}

export type ExperienceAction = Pick<ExperienceActionImpl, keyof ExperienceActionImpl>;

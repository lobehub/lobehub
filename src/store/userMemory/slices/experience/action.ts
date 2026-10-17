import { type ExperienceListItem } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import { type MemoryListPageResult, MemoryQueryList } from '../utils/memoryQueryList';
import {
  EXPERIENCE_LIST_PAGE_SIZE,
  type ExperienceListData,
  type ExperienceListParams,
  experienceListResource,
} from './projection';

const n = setNamespace('userMemory/experience');

export interface ExperienceQueryParams extends Partial<ExperienceListParams> {
  page?: number;
}

/** Flat mirrors of one page set (`undefined` = the active query has no view yet). */
const mirrorsOf = (data: ExperienceListData | undefined): Partial<UserMemoryStore> =>
  data
    ? {
        experienceListData: data,
        experiences: data.items,
        experiencesHasMore: data.hasMore,
        experiencesInit: true,
        experiencesPage: data.currentPage + 1,
        experiencesTotal: data.total ?? data.items.length,
      }
    : {
        experienceListData: undefined,
        experiences: [],
        experiencesHasMore: true,
        experiencesInit: false,
        experiencesPage: 1,
        experiencesTotal: 0,
      };

type Setter = StoreSetter<UserMemoryStore>;
export const createExperienceSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ExperienceActionImpl(set, get, _api);

/**
 * The user-memory experience list: one `MemoryQueryList` (shared with the other
 * offset-paged memory lists) behind the slice's long-standing action names.
 */
export class ExperienceActionImpl {
  readonly #list: MemoryQueryList<ExperienceListParams, ExperienceListItem, ExperienceListData>;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#list = new MemoryQueryList({
      actionPrefix: n('experienceList'),
      activeKeyField: 'experienceListKey',
      entriesField: 'experienceListEntries',
      fetchPage: async (params, page) => {
        const response = await userMemoryService.queryExperiences({
          page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
        });
        return { items: response.items, total: response.total };
      },
      get,
      mirror: mirrorsOf,
      queryFields: ({ q, sort }) => ({ experiencesQuery: q || undefined, experiencesSort: sort }),
      replicaField: 'experienceListReplica',
      resource: experienceListResource,
      rootKey: userMemoryKeys.experiences.root,
      set,
      useStore: (selector) => useUserMemoryStore(selector),
    });
  }

  /** Delete one experience: optimistic, then the offset repair (see `OffsetListPager`). */
  deleteExperience = (id: string): Promise<void> =>
    this.#list.delete(id, () => memoryCRUDService.deleteExperience(id));

  /** Purge for "delete all memories" (every query, memory + IndexedDB). */
  internal_clearExperienceList = (user?: string): Promise<boolean> => this.#list.clear(user);

  /** Confirmed edit of one experience in every loaded and persisted query. */
  internal_updateExperienceEntity = (
    id: string,
    fn: (item: ExperienceListItem) => ExperienceListItem,
  ): void => {
    this.#list.updateEntity(id, fn);
  };

  /** Append the next page of the query on screen. */
  loadMoreExperiences = (): void => {
    void this.#list.loadMore();
  };

  /** Seed the persisted head page of a query before its route paints. */
  preHydrateExperiences = (
    query?: Omit<ExperienceQueryParams, 'page' | 'pageSize'>,
  ): Promise<boolean> =>
    this.#list.preHydrate({
      ...query,
      pageSize: EXPERIENCE_LIST_PAGE_SIZE,
      q: query?.q || undefined,
    });

  /** Point the list at another search / sort (no page set is dropped). */
  resetExperiencesList = (params?: Omit<ExperienceQueryParams, 'page' | 'pageSize'>): void => {
    this.#list.select({ ...params, q: params?.q || undefined });
  };

  /** Fetch orchestration for the experience list page (see `MemoryQueryList.useFetch`). */
  useFetchExperiences = (
    params: ExperienceQueryParams,
  ): SWRResponse<MemoryListPageResult<ExperienceListItem>> => {
    const { page: _page, ...query } = params;
    return this.#list.useFetch({
      ...query,
      pageSize: params.pageSize ?? EXPERIENCE_LIST_PAGE_SIZE,
      q: params.q || undefined,
    });
  };
}

export type ExperienceAction = Pick<ExperienceActionImpl, keyof ExperienceActionImpl>;

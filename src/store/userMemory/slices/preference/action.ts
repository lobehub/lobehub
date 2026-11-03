import { type PreferenceMemorySimple, type UserMemoryItemSimple } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import { type MemoryListPageResult, MemoryQueryList } from '../utils/memoryQueryList';
import {
  PREFERENCE_LIST_PAGE_SIZE,
  type PreferenceListData,
  type PreferenceListParams,
  preferenceListResource,
} from './projection';

const n = setNamespace('userMemory/preference');

export interface PreferenceQueryParams extends Partial<PreferenceListParams> {
  page?: number;
}

/** Flat mirrors of one page set (`undefined` = the active query has no view yet). */
const mirrorsOf = (data: PreferenceListData | undefined): Partial<UserMemoryStore> =>
  data
    ? {
        preferenceListData: data,
        preferences: data.items,
        preferencesHasMore: data.hasMore,
        preferencesInit: true,
        preferencesPage: data.currentPage + 1,
        preferencesTotal: data.total ?? data.items.length,
      }
    : {
        preferenceListData: undefined,
        preferences: [],
        preferencesHasMore: true,
        preferencesInit: false,
        preferencesPage: 1,
        preferencesTotal: 0,
      };

/**
 * Flatten a `queryMemories` row into the display shape the preference list
 * renders. The endpoint returns `{ memory, preference }`; the row is merged in
 * the same order the previous slice did.
 */
const toDisplayPreference = (item: UserMemoryItemSimple): DisplayPreferenceMemory => {
  const { memory, preference } = item as PreferenceMemorySimple;
  return { ...memory, ...preference } as unknown as DisplayPreferenceMemory;
};

type Setter = StoreSetter<UserMemoryStore>;
export const createPreferenceSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new PreferenceActionImpl(set, get, _api);

/**
 * The user-memory preference list: one `MemoryQueryList` (shared with the other
 * offset-paged memory lists) behind the slice's long-standing action names.
 */
export class PreferenceActionImpl {
  readonly #list: MemoryQueryList<
    PreferenceListParams,
    DisplayPreferenceMemory,
    PreferenceListData
  >;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#list = new MemoryQueryList({
      actionPrefix: n('preferenceList'),
      activeKeyField: 'preferenceListKey',
      entriesField: 'preferenceListEntries',
      fetchPage: async (params, page) => {
        const response = await userMemoryService.queryMemories({
          layer: LayersEnum.Preference,
          page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
        });
        return { items: response.items.map(toDisplayPreference), total: response.total };
      },
      get,
      mirror: mirrorsOf,
      queryFields: ({ q, sort }) => ({ preferencesQuery: q || undefined, preferencesSort: sort }),
      replicaField: 'preferenceListReplica',
      resource: preferenceListResource,
      rootKey: userMemoryKeys.preferences.root,
      set,
      useStore: (selector) => useUserMemoryStore(selector),
    });
  }

  /** Delete one preference: optimistic, then the offset repair (see `OffsetListPager`). */
  deletePreference = (id: string): Promise<void> =>
    this.#list.delete(id, () => memoryCRUDService.deletePreference(id));

  /** Purge for "delete all memories" (every query, memory + IndexedDB). */
  internal_clearPreferenceList = (user?: string): Promise<boolean> => this.#list.clear(user);

  /** Confirmed edit of one preference in every loaded and persisted query. */
  internal_updatePreferenceEntity = (
    id: string,
    fn: (item: DisplayPreferenceMemory) => DisplayPreferenceMemory,
  ): void => {
    this.#list.updateEntity(id, fn);
  };

  /** Append the next page of the query on screen. */
  loadMorePreferences = (): void => {
    void this.#list.loadMore();
  };

  /** Seed the persisted head page of a query before its route paints. */
  preHydratePreferences = (
    query?: Omit<PreferenceQueryParams, 'page' | 'pageSize'>,
  ): Promise<boolean> =>
    this.#list.preHydrate({
      ...query,
      pageSize: PREFERENCE_LIST_PAGE_SIZE,
      q: query?.q || undefined,
    });

  /** Point the list at another search / sort (no page set is dropped). */
  resetPreferencesList = (params?: Omit<PreferenceQueryParams, 'page' | 'pageSize'>): void => {
    this.#list.select({ ...params, q: params?.q || undefined });
  };

  /** Fetch orchestration for the preference list page (see `MemoryQueryList.useFetch`). */
  useFetchPreferences = (
    params: PreferenceQueryParams,
  ): SWRResponse<MemoryListPageResult<DisplayPreferenceMemory>> => {
    const { page: _page, ...query } = params;
    return this.#list.useFetch({
      ...query,
      pageSize: params.pageSize ?? PREFERENCE_LIST_PAGE_SIZE,
      q: params.q || undefined,
    });
  };
}

export type PreferenceAction = Pick<PreferenceActionImpl, keyof PreferenceActionImpl>;

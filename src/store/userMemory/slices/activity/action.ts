import { type ActivityListItem } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import { type MemoryListPageResult, MemoryQueryList } from '../utils/memoryQueryList';
import {
  ACTIVITY_LIST_PAGE_SIZE,
  type ActivityListData,
  type ActivityListParams,
  activityListResource,
} from './projection';

const n = setNamespace('userMemory/activity');

export interface ActivityQueryParams extends Partial<ActivityListParams> {
  page?: number;
}

/** Flat mirrors of one page set (`undefined` = the active query has no view yet). */
const mirrorsOf = (data: ActivityListData | undefined): Partial<UserMemoryStore> =>
  data
    ? {
        activityListData: data,
        activities: data.items,
        activitiesHasMore: data.hasMore,
        activitiesInit: true,
        activitiesPage: data.currentPage + 1,
        activitiesTotal: data.total ?? data.items.length,
      }
    : {
        activityListData: undefined,
        activities: [],
        activitiesHasMore: true,
        activitiesInit: false,
        activitiesPage: 1,
        activitiesTotal: 0,
      };

type Setter = StoreSetter<UserMemoryStore>;
export const createActivitySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ActivityActionImpl(set, get, _api);

/**
 * The user-memory activity list: one `MemoryQueryList` (shared with the other
 * offset-paged memory lists) behind the slice's long-standing action names.
 */
export class ActivityActionImpl {
  readonly #list: MemoryQueryList<ActivityListParams, ActivityListItem, ActivityListData>;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#list = new MemoryQueryList({
      actionPrefix: n('activityList'),
      activeKeyField: 'activityListKey',
      entriesField: 'activityListEntries',
      fetchPage: async (params, page) => {
        const response = await userMemoryService.queryActivities({
          page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
          status: params.status,
          types: params.types,
        });
        return { items: response.items, total: response.total };
      },
      get,
      mirror: mirrorsOf,
      queryFields: ({ q, sort }) => ({ activitiesQuery: q || undefined, activitiesSort: sort }),
      replicaField: 'activityListReplica',
      resource: activityListResource,
      rootKey: userMemoryKeys.activities.root,
      set,
      useStore: (selector) => useUserMemoryStore(selector),
    });
  }

  /** Delete one activity: optimistic, then the offset repair (see `OffsetListPager`). */
  deleteActivity = (id: string): Promise<void> =>
    this.#list.delete(id, () => memoryCRUDService.deleteActivity(id));

  /** Purge for "delete all memories" (every query, memory + IndexedDB). */
  internal_clearActivityList = (user?: string): Promise<boolean> => this.#list.clear(user);

  /** Confirmed edit of one activity in every loaded and persisted query. */
  internal_updateActivityEntity = (
    id: string,
    fn: (item: ActivityListItem) => ActivityListItem,
  ): void => {
    this.#list.updateEntity(id, fn);
  };

  /** Append the next page of the query on screen. */
  loadMoreActivities = (): void => {
    void this.#list.loadMore();
  };

  /** Seed the persisted head page of a query before its route paints. */
  preHydrateActivities = (
    query?: Omit<ActivityQueryParams, 'page' | 'pageSize'>,
  ): Promise<boolean> =>
    this.#list.preHydrate({
      ...query,
      pageSize: ACTIVITY_LIST_PAGE_SIZE,
      q: query?.q || undefined,
    });

  /** Point the list at another search / sort (no page set is dropped). */
  resetActivitiesList = (params?: Omit<ActivityQueryParams, 'page' | 'pageSize'>): void => {
    this.#list.select({ ...params, q: params?.q || undefined });
  };

  /** Fetch orchestration for the activity list page (see `MemoryQueryList.useFetch`). */
  useFetchActivities = (
    params: ActivityQueryParams,
  ): SWRResponse<MemoryListPageResult<ActivityListItem>> => {
    const { page: _page, ...query } = params;
    return this.#list.useFetch({
      ...query,
      pageSize: params.pageSize ?? ACTIVITY_LIST_PAGE_SIZE,
      q: params.q || undefined,
    });
  };
}

export type ActivityAction = Pick<ActivityActionImpl, keyof ActivityActionImpl>;

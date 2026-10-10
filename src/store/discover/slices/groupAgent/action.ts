import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import type { DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import type { StoreSetter } from '@/store/types';
import type {
  DiscoverGroupAgentDetail,
  GroupAgentListResponse,
  GroupAgentQueryParams,
  IdentifiersResponse,
} from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import {
  type GroupAgentCategoriesParams,
  groupAgentCategoriesQueryKey,
  groupAgentCategoriesResource,
  type GroupAgentDetailParams,
  groupAgentDetailQueryKey,
  groupAgentDetailResource,
  type GroupAgentIdentifiersParams,
  groupAgentIdentifiersQueryKey,
  groupAgentIdentifiersResource,
  type GroupAgentListParams,
  groupAgentListQueryKey,
  groupAgentListResource,
} from './projection';

const n = setNamespace('discover/groupAgent');

/**
 * Sync flags of a market read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `groupAgentSelectors` entry.
 */
export interface GroupAgentSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `groupAgentSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createGroupAgentSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new GroupAgentActionImpl(set, get, _api);

export class GroupAgentActionImpl {
  readonly #categories;
  readonly #detail;
  readonly #get: () => DiscoverStore;
  readonly #identifiers;
  readonly #list;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(groupAgentListResource, {
      actionPrefix: n('list'),
      get,
      set,
      stateKey: 'groupAgentListReplica',
      view: recordLens<DiscoverStore, GroupAgentListResponse>('groupAgentListMap'),
    });
    this.#detail = createReplicaSlice(groupAgentDetailResource, {
      actionPrefix: n('detail'),
      get,
      set,
      stateKey: 'groupAgentDetailReplica',
      view: recordLens<DiscoverStore, DiscoverGroupAgentDetail>('groupAgentDetailMap'),
    });
    this.#categories = createReplicaSlice(groupAgentCategoriesResource, {
      actionPrefix: n('categories'),
      get,
      set,
      stateKey: 'groupAgentCategoriesReplica',
      view: recordLens<DiscoverStore, CategoryItem[]>('groupAgentCategoriesMap'),
    });
    this.#identifiers = createReplicaSlice(groupAgentIdentifiersResource, {
      actionPrefix: n('identifiers'),
      get,
      set,
      stateKey: 'groupAgentIdentifiersReplica',
      view: recordLens<DiscoverStore, IdentifiersResponse>('groupAgentIdentifiersMap'),
    });
  }

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
    active: boolean,
  ): GroupAgentSyncResult => ({
    ...sync,
    // A disabled hook never loads; a settled entry with a value never flashes.
    isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
    mutate: sync.revalidate,
    queryKey: active ? queryKey : undefined,
  });

  /**
   * The group-agent market list of one query. Each (filters · page) pair is its
   * own entry, so the URL-driven pager walks entries instead of appending
   * pages. Read the rows with `groupAgentSelectors.groupAgentList(queryKey)`.
   */
  useFetchGroupAgentList = (
    params: GroupAgentQueryParams = {},
    options: { enabled?: boolean } = {},
  ): GroupAgentSyncResult => {
    const { enabled = true } = options;
    const normalized: GroupAgentListParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    };
    const queryKey = groupAgentListQueryKey(normalized);
    const sync = this.#list.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().groupAgentListMap[queryKey], enabled);
  };

  /**
   * One group-agent detail (identifier · version). Read it with
   * `groupAgentSelectors.groupAgentDetail(queryKey)`; `undefined` after the sync
   * settles means the market has no such identifier.
   */
  useFetchGroupAgentDetail = (
    params: GroupAgentDetailParams,
    options: { enabled?: boolean } = {},
  ): GroupAgentSyncResult => {
    const { enabled = true } = options;
    const normalized: GroupAgentDetailParams = {
      identifier: params.identifier,
      locale: globalHelpers.getCurrentLanguage(),
      version: params.version,
    };
    const queryKey = groupAgentDetailQueryKey(normalized);
    const sync = this.#detail.useSync(normalized, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().groupAgentDetailMap[queryKey] !== undefined,
      enabled,
    );
  };

  /**
   * Category counts of one query (the search term). The community sidebar reads
   * `groupAgentSelectors.groupAgentCategories(queryKey)`.
   */
  useFetchGroupAgentCategories = (
    params: GroupAgentCategoriesParams = {},
    options: { enabled?: boolean } = {},
  ): GroupAgentSyncResult => {
    const { enabled = true } = options;
    const normalized: GroupAgentCategoriesParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
    };
    const queryKey = groupAgentCategoriesQueryKey(normalized);
    const sync = this.#categories.useSync(normalized, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      !!this.#get().groupAgentCategoriesMap[queryKey],
      enabled,
    );
  };

  /** The group-agent identifier index of the market. */
  useFetchGroupAgentIdentifiers = (options: { enabled?: boolean } = {}): GroupAgentSyncResult => {
    const { enabled = true } = options;
    const params: GroupAgentIdentifiersParams = {};
    const queryKey = groupAgentIdentifiersQueryKey(params);
    const sync = this.#identifiers.useSync(params, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      !!this.#get().groupAgentIdentifiersMap[queryKey],
      enabled,
    );
  };
}

export type GroupAgentAction = Pick<GroupAgentActionImpl, keyof GroupAgentActionImpl>;

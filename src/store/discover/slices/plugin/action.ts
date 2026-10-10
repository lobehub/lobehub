import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import type { DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import type { StoreSetter } from '@/store/types';
import type {
  DiscoverPluginDetail,
  IdentifiersResponse,
  PluginListResponse,
  PluginQueryParams,
} from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import {
  type PluginCategoriesParams,
  pluginCategoriesQueryKey,
  pluginCategoriesResource,
  type PluginDetailParams,
  pluginDetailQueryKey,
  pluginDetailResource,
  type PluginIdentifiersParams,
  pluginIdentifiersQueryKey,
  pluginIdentifiersResource,
  type PluginListParams,
  pluginListQueryKey,
  pluginListResource,
} from './projection';

const n = setNamespace('discover/plugin');

/**
 * Sync flags of a market read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `pluginSelectors` entry.
 */
export interface PluginSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `pluginSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createPluginSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new PluginActionImpl(set, get, _api);

export class PluginActionImpl {
  readonly #categories;
  readonly #detail;
  readonly #get: () => DiscoverStore;
  readonly #identifiers;
  readonly #list;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(pluginListResource, {
      actionPrefix: n('list'),
      get,
      set,
      stateKey: 'pluginListReplica',
      view: recordLens<DiscoverStore, PluginListResponse>('pluginListMap'),
    });
    this.#detail = createReplicaSlice(pluginDetailResource, {
      actionPrefix: n('detail'),
      get,
      set,
      stateKey: 'pluginDetailReplica',
      view: recordLens<DiscoverStore, DiscoverPluginDetail>('pluginDetailMap'),
    });
    this.#categories = createReplicaSlice(pluginCategoriesResource, {
      actionPrefix: n('categories'),
      get,
      set,
      stateKey: 'pluginCategoriesReplica',
      view: recordLens<DiscoverStore, CategoryItem[]>('pluginCategoriesMap'),
    });
    this.#identifiers = createReplicaSlice(pluginIdentifiersResource, {
      actionPrefix: n('identifiers'),
      get,
      set,
      stateKey: 'pluginIdentifiersReplica',
      view: recordLens<DiscoverStore, IdentifiersResponse>('pluginIdentifiersMap'),
    });
  }

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
    active: boolean,
  ): PluginSyncResult => ({
    ...sync,
    // A disabled hook never loads; a settled entry with a value never flashes.
    isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
    mutate: sync.revalidate,
    queryKey: active ? queryKey : undefined,
  });

  /**
   * The plugin market list of one query. Each (filters · page) pair is its own
   * entry, so the URL-driven pager walks entries instead of appending pages.
   * Read the rows with `pluginSelectors.pluginList(queryKey)`.
   */
  useFetchPluginList = (
    params: PluginQueryParams = {},
    options: { enabled?: boolean } = {},
  ): PluginSyncResult => {
    const { enabled = true } = options;
    const normalized: PluginListParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    };
    const queryKey = pluginListQueryKey(normalized);
    const sync = this.#list.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().pluginListMap[queryKey], enabled);
  };

  /**
   * One plugin detail by identifier. Read it with
   * `pluginSelectors.pluginDetail(queryKey)`; `undefined` while disabled or
   * after the sync settles means the market has no such identifier (the caller
   * then falls back to its builtin / composio metadata).
   */
  useFetchPluginDetail = (
    params: { identifier?: string; withManifest?: boolean },
    options: { enabled?: boolean } = {},
  ): PluginSyncResult => {
    const { enabled = true } = options;
    const active = enabled && !!params.identifier;
    const normalized: PluginDetailParams = {
      identifier: params.identifier ?? '',
      locale: globalHelpers.getCurrentLanguage(),
      withManifest: params.withManifest,
    };
    const queryKey = pluginDetailQueryKey(normalized);
    const sync = this.#detail.useSync(normalized, { enabled: active });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().pluginDetailMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * Category counts of one query (the search term). The community sidebar reads
   * `pluginSelectors.pluginCategories(queryKey)`.
   */
  useFetchPluginCategories = (
    params: PluginCategoriesParams = {},
    options: { enabled?: boolean } = {},
  ): PluginSyncResult => {
    const { enabled = true } = options;
    const queryKey = pluginCategoriesQueryKey(params);
    const sync = this.#categories.useSync(params, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().pluginCategoriesMap[queryKey], enabled);
  };

  /** The plugin identifier index. */
  useFetchPluginIdentifiers = (options: { enabled?: boolean } = {}): PluginSyncResult => {
    const { enabled = true } = options;
    const params: PluginIdentifiersParams = {};
    const queryKey = pluginIdentifiersQueryKey(params);
    const sync = this.#identifiers.useSync(params, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      !!this.#get().pluginIdentifiersMap[queryKey],
      enabled,
    );
  };
}

export type PluginAction = Pick<PluginActionImpl, keyof PluginActionImpl>;

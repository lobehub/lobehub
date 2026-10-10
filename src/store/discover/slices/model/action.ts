import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import type { DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import type { StoreSetter } from '@/store/types';
import type {
  DiscoverModelDetail,
  IdentifiersResponse,
  ModelListResponse,
  ModelQueryParams,
} from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import {
  type ModelCategoriesParams,
  modelCategoriesQueryKey,
  modelCategoriesResource,
  type ModelDetailParams,
  modelDetailQueryKey,
  modelDetailResource,
  type ModelIdentifiersParams,
  modelIdentifiersQueryKey,
  modelIdentifiersResource,
  type ModelListParams,
  modelListQueryKey,
  modelListResource,
} from './projection';

const n = setNamespace('discover/model');

/**
 * Sync flags of a market read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `modelSelectors` entry.
 */
export interface ModelSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `modelSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createModelSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new ModelActionImpl(set, get, _api);

export class ModelActionImpl {
  readonly #categories;
  readonly #detail;
  readonly #get: () => DiscoverStore;
  readonly #identifiers;
  readonly #list;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(modelListResource, {
      actionPrefix: n('list'),
      get,
      set,
      stateKey: 'modelListReplica',
      view: recordLens<DiscoverStore, ModelListResponse>('modelListMap'),
    });
    this.#detail = createReplicaSlice(modelDetailResource, {
      actionPrefix: n('detail'),
      get,
      set,
      stateKey: 'modelDetailReplica',
      view: recordLens<DiscoverStore, DiscoverModelDetail>('modelDetailMap'),
    });
    this.#categories = createReplicaSlice(modelCategoriesResource, {
      actionPrefix: n('categories'),
      get,
      set,
      stateKey: 'modelCategoriesReplica',
      view: recordLens<DiscoverStore, CategoryItem[]>('modelCategoriesMap'),
    });
    this.#identifiers = createReplicaSlice(modelIdentifiersResource, {
      actionPrefix: n('identifiers'),
      get,
      set,
      stateKey: 'modelIdentifiersReplica',
      view: recordLens<DiscoverStore, IdentifiersResponse>('modelIdentifiersMap'),
    });
  }

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
    active: boolean,
  ): ModelSyncResult => ({
    ...sync,
    // A disabled hook never loads; a settled entry with a value never flashes.
    isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
    mutate: sync.revalidate,
    queryKey: active ? queryKey : undefined,
  });

  /**
   * The model market list of one query. Each (filters · page) pair is its own
   * entry, so the URL-driven pager walks entries instead of appending pages.
   * Read the rows with `modelSelectors.modelList(queryKey)`.
   */
  useFetchModelList = (
    params: ModelQueryParams = {},
    options: { enabled?: boolean } = {},
  ): ModelSyncResult => {
    const { enabled = true } = options;
    const normalized: ModelListParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    };
    const queryKey = modelListQueryKey(normalized);
    const sync = this.#list.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().modelListMap[queryKey], enabled);
  };

  /**
   * One model detail by identifier. Read it with
   * `modelSelectors.modelDetail(queryKey)`; `undefined` after the sync settles
   * means the market has no such identifier.
   */
  useFetchModelDetail = (
    params: ModelDetailParams,
    options: { enabled?: boolean } = {},
  ): ModelSyncResult => {
    const { enabled = true } = options;
    const normalized: ModelDetailParams = {
      identifier: params.identifier,
      locale: globalHelpers.getCurrentLanguage(),
    };
    const queryKey = modelDetailQueryKey(normalized);
    const sync = this.#detail.useSync(normalized, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().modelDetailMap[queryKey] !== undefined,
      enabled,
    );
  };

  /**
   * Category counts of one query (the search term). The community sidebar reads
   * `modelSelectors.modelCategories(queryKey)`.
   */
  useFetchModelCategories = (
    params: ModelCategoriesParams = {},
    options: { enabled?: boolean } = {},
  ): ModelSyncResult => {
    const { enabled = true } = options;
    const queryKey = modelCategoriesQueryKey(params);
    const sync = this.#categories.useSync(params, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().modelCategoriesMap[queryKey], enabled);
  };

  /** The model identifier index. */
  useFetchModelIdentifiers = (options: { enabled?: boolean } = {}): ModelSyncResult => {
    const { enabled = true } = options;
    const params: ModelIdentifiersParams = {};
    const queryKey = modelIdentifiersQueryKey(params);
    const sync = this.#identifiers.useSync(params, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().modelIdentifiersMap[queryKey], enabled);
  };
}

export type ModelAction = Pick<ModelActionImpl, keyof ModelActionImpl>;

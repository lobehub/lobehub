import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import type { DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import type { StoreSetter } from '@/store/types';
import type {
  DiscoverProviderDetail,
  IdentifiersResponse,
  ProviderListResponse,
  ProviderQueryParams,
} from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import {
  type ProviderDetailParams,
  providerDetailQueryKey,
  providerDetailResource,
  type ProviderIdentifiersParams,
  providerIdentifiersQueryKey,
  providerIdentifiersResource,
  type ProviderListParams,
  providerListQueryKey,
  providerListResource,
} from './projection';

const n = setNamespace('discover/provider');

/**
 * Sync flags of a market read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `providerSelectors` entry.
 */
export interface ProviderSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `providerSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createProviderSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new ProviderActionImpl(set, get, _api);

export class ProviderActionImpl {
  readonly #detail;
  readonly #get: () => DiscoverStore;
  readonly #identifiers;
  readonly #list;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(providerListResource, {
      actionPrefix: n('list'),
      get,
      set,
      stateKey: 'providerListReplica',
      view: recordLens<DiscoverStore, ProviderListResponse>('providerListMap'),
    });
    this.#detail = createReplicaSlice(providerDetailResource, {
      actionPrefix: n('detail'),
      get,
      set,
      stateKey: 'providerDetailReplica',
      view: recordLens<DiscoverStore, DiscoverProviderDetail>('providerDetailMap'),
    });
    this.#identifiers = createReplicaSlice(providerIdentifiersResource, {
      actionPrefix: n('identifiers'),
      get,
      set,
      stateKey: 'providerIdentifiersReplica',
      view: recordLens<DiscoverStore, IdentifiersResponse>('providerIdentifiersMap'),
    });
  }

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
    active: boolean,
  ): ProviderSyncResult => ({
    ...sync,
    // A disabled hook never loads; a settled entry with a value never flashes.
    isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
    mutate: sync.revalidate,
    queryKey: active ? queryKey : undefined,
  });

  /**
   * The provider market list of one query. Each (filters · page) pair is its
   * own entry, so the URL-driven pager walks entries instead of appending
   * pages. Read the rows with `providerSelectors.providerList(queryKey)`.
   */
  useFetchProviderList = (
    params: ProviderQueryParams = {},
    options: { enabled?: boolean } = {},
  ): ProviderSyncResult => {
    const { enabled = true } = options;
    const normalized: ProviderListParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    };
    const queryKey = providerListQueryKey(normalized);
    const sync = this.#list.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().providerListMap[queryKey], enabled);
  };

  /**
   * One provider detail by identifier. Read it with
   * `providerSelectors.providerDetail(queryKey)`; `undefined` after the sync
   * settles means the market has no such identifier.
   */
  useFetchProviderDetail = (
    params: ProviderDetailParams,
    options: { enabled?: boolean } = {},
  ): ProviderSyncResult => {
    const { enabled = true } = options;
    const normalized: ProviderDetailParams = {
      identifier: params.identifier,
      locale: globalHelpers.getCurrentLanguage(),
      withReadme: params.withReadme,
    };
    const queryKey = providerDetailQueryKey(normalized);
    const sync = this.#detail.useSync(normalized, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().providerDetailMap[queryKey] !== undefined,
      enabled,
    );
  };

  /** The provider identifier index. */
  useFetchProviderIdentifiers = (options: { enabled?: boolean } = {}): ProviderSyncResult => {
    const { enabled = true } = options;
    const params: ProviderIdentifiersParams = {};
    const queryKey = providerIdentifiersQueryKey(params);
    const sync = this.#identifiers.useSync(params, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      !!this.#get().providerIdentifiersMap[queryKey],
      enabled,
    );
  };
}

export type ProviderAction = Pick<ProviderActionImpl, keyof ProviderActionImpl>;

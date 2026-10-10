import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import type { DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import type { StoreSetter } from '@/store/types';
import type {
  AssistantListResponse,
  AssistantQueryParams,
  DiscoverAssistantDetail,
  IdentifiersResponse,
} from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import {
  type AssistantCategoriesParams,
  assistantCategoriesQueryKey,
  assistantCategoriesResource,
  type AssistantDetailParams,
  assistantDetailQueryKey,
  assistantDetailResource,
  type AssistantIdentifiersParams,
  assistantIdentifiersQueryKey,
  assistantIdentifiersResource,
  type AssistantListParams,
  assistantListQueryKey,
  assistantListResource,
} from './projection';

const n = setNamespace('discover/assistant');

/**
 * Sync flags of a market read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `assistantSelectors` entry.
 */
export interface AssistantSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `assistantSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createAssistantSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new AssistantActionImpl(set, get, _api);

export class AssistantActionImpl {
  readonly #categories;
  readonly #detail;
  readonly #get: () => DiscoverStore;
  readonly #identifiers;
  readonly #list;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(assistantListResource, {
      actionPrefix: n('list'),
      get,
      set,
      stateKey: 'assistantListReplica',
      view: recordLens<DiscoverStore, AssistantListResponse>('assistantListMap'),
    });
    this.#detail = createReplicaSlice(assistantDetailResource, {
      actionPrefix: n('detail'),
      get,
      set,
      stateKey: 'assistantDetailReplica',
      view: recordLens<DiscoverStore, DiscoverAssistantDetail>('assistantDetailMap'),
    });
    this.#categories = createReplicaSlice(assistantCategoriesResource, {
      actionPrefix: n('categories'),
      get,
      set,
      stateKey: 'assistantCategoriesReplica',
      view: recordLens<DiscoverStore, CategoryItem[]>('assistantCategoriesMap'),
    });
    this.#identifiers = createReplicaSlice(assistantIdentifiersResource, {
      actionPrefix: n('identifiers'),
      get,
      set,
      stateKey: 'assistantIdentifiersReplica',
      view: recordLens<DiscoverStore, IdentifiersResponse>('assistantIdentifiersMap'),
    });
  }

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
    active: boolean,
  ): AssistantSyncResult => ({
    ...sync,
    // A disabled hook never loads; a settled entry with a value never flashes.
    isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
    mutate: sync.revalidate,
    queryKey: active ? queryKey : undefined,
  });

  /**
   * The assistant market list of one query. Each (filters · page) pair is its
   * own entry, so the URL-driven pager walks entries instead of appending
   * pages. Read the rows with `assistantSelectors.assistantList(queryKey)`.
   */
  useFetchAssistantList = (
    params: AssistantQueryParams = {},
    options: { enabled?: boolean } = {},
  ): AssistantSyncResult => {
    const { enabled = true } = options;
    const normalized: AssistantListParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    };
    const queryKey = assistantListQueryKey(normalized);
    const sync = this.#list.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().assistantListMap[queryKey], enabled);
  };

  /**
   * One assistant detail (identifier · source · version). Read it with
   * `assistantSelectors.assistantDetail(queryKey)`; `undefined` after the sync
   * settles means the market has no such identifier.
   */
  useFetchAssistantDetail = (
    params: AssistantDetailParams,
    options: { enabled?: boolean } = {},
  ): AssistantSyncResult => {
    const { enabled = true } = options;
    const normalized: AssistantDetailParams = {
      identifier: params.identifier,
      locale: globalHelpers.getCurrentLanguage(),
      source: params.source,
      version: params.version,
    };
    const queryKey = assistantDetailQueryKey(normalized);
    const sync = this.#detail.useSync(normalized, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().assistantDetailMap[queryKey] !== undefined,
      enabled,
    );
  };

  /**
   * Category counts of one query (the search term + source). The community
   * sidebar reads `assistantSelectors.assistantCategories(queryKey)`; it is the
   * fallback when a list response carries no `categoryCounts`.
   */
  useFetchAssistantCategories = (
    params: AssistantCategoriesParams = {},
    options: { enabled?: boolean } = {},
  ): AssistantSyncResult => {
    const { enabled = true } = options;
    const normalized: AssistantCategoriesParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
    };
    const queryKey = assistantCategoriesQueryKey(normalized);
    const sync = this.#categories.useSync(normalized, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      !!this.#get().assistantCategoriesMap[queryKey],
      enabled,
    );
  };

  /** The identifier index of one market source. */
  useFetchAssistantIdentifiers = (
    params: AssistantIdentifiersParams = {},
    options: { enabled?: boolean } = {},
  ): AssistantSyncResult => {
    const { enabled = true } = options;
    const queryKey = assistantIdentifiersQueryKey(params);
    const sync = this.#identifiers.useSync(params, { enabled });
    return this.#toSyncResult(
      sync,
      queryKey,
      !!this.#get().assistantIdentifiersMap[queryKey],
      enabled,
    );
  };
}

export type AssistantAction = Pick<AssistantActionImpl, keyof AssistantActionImpl>;

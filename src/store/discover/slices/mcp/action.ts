import type { CategoryItem, CategoryListQuery } from '@lobehub/market-sdk';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import type { DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import type { StoreSetter } from '@/store/types';
import type { DiscoverMcpDetail, McpListResponse, McpQueryParams } from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import {
  type McpCategoriesParams,
  mcpCategoriesQueryKey,
  mcpCategoriesResource,
  type McpDetailParams,
  mcpDetailQueryKey,
  mcpDetailResource,
  type McpListParams,
  mcpListQueryKey,
  mcpListResource,
} from './projection';

const n = setNamespace('discover/mcp');

/**
 * Sync flags of a market read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `mcpSelectors` entry.
 */
export interface MCPSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `mcpSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createMCPSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new MCPActionImpl(set, get, _api);

export class MCPActionImpl {
  readonly #categories;
  readonly #detail;
  readonly #get: () => DiscoverStore;
  readonly #list;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(mcpListResource, {
      actionPrefix: n('list'),
      get,
      set,
      stateKey: 'mcpListReplica',
      view: recordLens<DiscoverStore, McpListResponse>('mcpListMap'),
    });
    this.#detail = createReplicaSlice(mcpDetailResource, {
      actionPrefix: n('detail'),
      get,
      set,
      stateKey: 'mcpDetailReplica',
      view: recordLens<DiscoverStore, DiscoverMcpDetail>('mcpDetailMap'),
    });
    this.#categories = createReplicaSlice(mcpCategoriesResource, {
      actionPrefix: n('categories'),
      get,
      set,
      stateKey: 'mcpCategoriesReplica',
      view: recordLens<DiscoverStore, CategoryItem[]>('mcpCategoriesMap'),
    });
  }

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
    active: boolean,
  ): MCPSyncResult => ({
    ...sync,
    // A disabled hook never loads; a settled entry with a value never flashes.
    isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
    mutate: sync.revalidate,
    queryKey: active ? queryKey : undefined,
  });

  /**
   * The MCP market list of one query. Each (filters · page) pair is its own
   * entry, so the URL-driven pager walks entries instead of appending pages.
   * Read the rows with `mcpSelectors.mcpList(queryKey)`.
   */
  useFetchMcpList = (
    params: McpQueryParams = {},
    options: { enabled?: boolean } = {},
  ): MCPSyncResult => {
    const { enabled = true } = options;
    const normalized: McpListParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    };
    const queryKey = mcpListQueryKey(normalized);
    const sync = this.#list.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().mcpListMap[queryKey], enabled);
  };

  /**
   * One MCP detail by identifier (with an optional pinned `version`). Read it
   * with `mcpSelectors.mcpDetail(queryKey)`; `undefined` after the sync settles
   * means the market has no such identifier — or no identifier was given, in
   * which case the read is disabled and the hook reports no loading.
   */
  useFetchMcpDetail = (
    { identifier, version }: { identifier?: string; version?: string } = {},
    options: { enabled?: boolean } = {},
  ): MCPSyncResult => {
    const { enabled = true } = options;
    // Without an identifier there is nothing to fetch — never load a blank key.
    const active = enabled && !!identifier;
    const normalized: McpDetailParams = {
      identifier: identifier ?? '',
      locale: globalHelpers.getCurrentLanguage(),
      version,
    };
    const queryKey = mcpDetailQueryKey(normalized);
    const sync = this.#detail.useSync(normalized, { enabled: active });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().mcpDetailMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * Category counts of one query (the search term). The community sidebar reads
   * `mcpSelectors.mcpCategories(queryKey)`.
   */
  useMcpCategories = (
    params: CategoryListQuery = {},
    options: { enabled?: boolean } = {},
  ): MCPSyncResult => {
    const { enabled = true } = options;
    const normalized: McpCategoriesParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
    };
    const queryKey = mcpCategoriesQueryKey(normalized);
    const sync = this.#categories.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().mcpCategoriesMap[queryKey], enabled);
  };
}

export type MCPAction = Pick<MCPActionImpl, keyof MCPActionImpl>;

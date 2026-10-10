import type { CategoryItem, CategoryListQuery } from '@lobehub/market-sdk';

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import type { DiscoverMcpDetail, McpListResponse, McpQueryParams } from '@/types/discover';

/**
 * The marketplace MCP reads are **read-only**: no optimistic write, no
 * cross-copy entity link. What the replica buys here is the first frame — the
 * last confirmed page paints before the network answers — and one cache
 * partition per identity (the `cacheScope`), so switching account or workspace
 * never serves the previous one's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces: the community list paginates by URL (`?page=N`), so a page flip is
 * a different entry rather than a `loadMore` of the same one.
 */

/** Normalized `mcpList` params — the shape actually sent to the market endpoint. */
export interface McpListParams extends Omit<McpQueryParams, 'page' | 'pageSize'> {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
  page: number;
  pageSize: number;
}

/**
 * Entry key of one MCP list query. Includes the page, because the list pages
 * through the URL instead of appending pages to one entry.
 */
export const mcpListQueryKey = (params: McpListParams): string => stableQueryKey(params);

export interface McpDetailParams {
  identifier: string;
  /** Current UI language; the market resolves localized copy server-side. */
  locale?: string;
  /** Pinned marketplace version; a different version is a different entry. */
  version?: string;
}

/** Entry key of one MCP detail (`identifier` · `version`, localized). */
export const mcpDetailQueryKey = (params: McpDetailParams): string => stableQueryKey(params);

/** Category counts query of the community MCP sidebar (the search term). */
export type McpCategoriesParams = CategoryListQuery & {
  /** The old SWR key carried the locale, so a language switch refetches. */
  locale?: string;
};

/** Entry key of one category-counts query. */
export const mcpCategoriesQueryKey = (params: McpCategoriesParams): string =>
  stableQueryKey(params);

/**
 * MCP market list, one entry per query (`mcpListMap[queryKey]`). The response
 * already carries everything a row reader needs (`items`, `currentPage`,
 * `pageSize`, `totalCount`), so it is stored as-is.
 */
export const mcpListResource = defineReplica<McpListParams, McpListResponse>({
  fetcher: (params) => discoverService.getMcpList(params),
  key: mcpListQueryKey,
  name: 'mcpList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One MCP detail by identifier (`mcpDetailMap[key]`). The fetcher answers
 * `undefined` for an identifier the market no longer has; the default merge
 * keeps whatever is already cached in that case, and an empty slot stays empty
 * so the page can render "not found" once the sync settles.
 */
export const mcpDetailResource = defineReplica<
  McpDetailParams,
  DiscoverMcpDetail,
  DiscoverMcpDetail | undefined
>({
  fetcher: (params) => discoverService.getMcpDetail(params),
  key: mcpDetailQueryKey,
  name: 'mcpDetail',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Category counts of one query (`mcpCategoriesMap[queryKey]`). Small and read
 * on almost every community MCP screen, so localStorage keeps the first frame
 * populated instead of flashing an empty sidebar.
 */
export const mcpCategoriesResource = defineReplica<McpCategoriesParams, CategoryItem[]>({
  fetcher: (params) => discoverService.getMcpCategories(params),
  key: mcpCategoriesQueryKey,
  name: 'mcpCategories',
  storage: 'localStorage',
  version: 1,
});

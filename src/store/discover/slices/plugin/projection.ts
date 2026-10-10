import type { CategoryItem, CategoryListQuery } from '@lobehub/market-sdk';

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import type {
  DiscoverPluginDetail,
  IdentifiersResponse,
  PluginListResponse,
  PluginQueryParams,
} from '@/types/discover';

/**
 * The marketplace plugin reads are **read-only**: no optimistic write, no
 * cross-copy entity link. What the replica buys here is the first frame — the
 * last confirmed page / detail paints before the network answers — and one
 * cache partition per identity (the `cacheScope`), so switching account or
 * workspace never serves the previous one's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces: the plugin list paginates by URL (`?page=N`), so a page flip is a
 * different entry rather than a `loadMore` of the same one.
 */

/** Normalized `pluginList` params — the shape actually sent to the market endpoint. */
export interface PluginListParams extends Omit<PluginQueryParams, 'page' | 'pageSize'> {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
  page: number;
  pageSize: number;
}

/**
 * Entry key of one plugin list query. Includes the page, because the list pages
 * through the URL instead of appending pages to one entry.
 */
export const pluginListQueryKey = (params: PluginListParams): string => stableQueryKey(params);

export interface PluginDetailParams {
  identifier: string;
  /** Current UI language; the market resolves localized copy server-side. */
  locale?: string;
  /** Whether the entry carries the compiled manifest; a distinct entry per value. */
  withManifest?: boolean;
}

/** Entry key of one plugin detail (`identifier`, localized, manifest or not). */
export const pluginDetailQueryKey = (params: PluginDetailParams): string => stableQueryKey(params);

/** Category counts query of the community plugin sidebar (the search term). */
export type PluginCategoriesParams = CategoryListQuery;

/** Entry key of one category-counts query (the search term). */
export const pluginCategoriesQueryKey = (params: PluginCategoriesParams): string =>
  stableQueryKey(params);

/** The plugin identifier index takes no query — one entry for the whole index. */
export type PluginIdentifiersParams = Record<string, never>;

/** Entry key of the plugin identifier index. */
export const pluginIdentifiersQueryKey = (params: PluginIdentifiersParams = {}): string =>
  stableQueryKey(params);

/**
 * Plugin market list, one entry per query (`pluginListMap[queryKey]`). The
 * response already carries everything a row reader needs (`items`,
 * `currentPage`, `pageSize`, `totalCount`), so it is stored as-is.
 */
export const pluginListResource = defineReplica<PluginListParams, PluginListResponse>({
  fetcher: (params) => discoverService.getPluginList(params),
  key: pluginListQueryKey,
  name: 'pluginList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One plugin detail by identifier (`pluginDetailMap[key]`). The fetcher answers
 * `undefined` for an identifier the market no longer has; the default merge
 * keeps whatever is already cached in that case, and an empty slot stays empty
 * so the surface can fall back to its builtin / composio metadata.
 */
export const pluginDetailResource = defineReplica<
  PluginDetailParams,
  DiscoverPluginDetail,
  DiscoverPluginDetail | undefined
>({
  fetcher: (params) => discoverService.getPluginDetail(params),
  key: pluginDetailQueryKey,
  name: 'pluginDetail',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Category counts of one query (`pluginCategoriesMap[queryKey]`). Small and read
 * on almost every community plugin screen, so localStorage keeps the first frame
 * populated instead of flashing an empty sidebar.
 */
export const pluginCategoriesResource = defineReplica<PluginCategoriesParams, CategoryItem[]>({
  fetcher: (params) => discoverService.getPluginCategories(params),
  key: pluginCategoriesQueryKey,
  name: 'pluginCategories',
  storage: 'localStorage',
  version: 1,
});

/** The plugin identifier index (`pluginIdentifiersMap[queryKey]`). */
export const pluginIdentifiersResource = defineReplica<
  PluginIdentifiersParams,
  IdentifiersResponse
>({
  fetcher: () => discoverService.getPluginIdentifiers(),
  key: pluginIdentifiersQueryKey,
  name: 'pluginIdentifiers',
  storage: 'localStorage',
  version: 1,
});

import type { CategoryItem, CategoryListQuery } from '@lobehub/market-sdk';

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import type {
  AssistantListResponse,
  AssistantMarketSource,
  AssistantQueryParams,
  DiscoverAssistantDetail,
  IdentifiersResponse,
} from '@/types/discover';

/**
 * The marketplace assistant reads are **read-only**: no optimistic write, no
 * cross-copy entity link. What the replica buys here is the first frame — the
 * last confirmed page paints before the network answers — and one cache
 * partition per identity (the `cacheScope`), so switching account or workspace
 * never serves the previous one's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces: the community list paginates by URL (`?page=N`), so a page flip is
 * a different entry rather than a `loadMore` of the same one.
 */

/** Normalized `assistantList` params — the shape actually sent to the market endpoint. */
export interface AssistantListParams extends Omit<AssistantQueryParams, 'page' | 'pageSize'> {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
  page: number;
  pageSize: number;
}

/**
 * Entry key of one assistant list query. Includes the page, because the list
 * pages through the URL instead of appending pages to one entry.
 */
export const assistantListQueryKey = (params: AssistantListParams): string =>
  stableQueryKey(params);

export interface AssistantDetailParams {
  identifier: string;
  /** Current UI language; the market resolves localized copy server-side. */
  locale?: string;
  source?: AssistantMarketSource;
  version?: string;
}

/** Entry key of one assistant detail (`identifier` + source + version). */
export const assistantDetailQueryKey = (params: AssistantDetailParams): string =>
  stableQueryKey(params);

export interface AssistantCategoriesParams extends CategoryListQuery {
  /** Current UI language; the market resolves localized category labels. */
  locale?: string;
  source?: AssistantMarketSource;
}

/** Entry key of one category-counts query (the search term + source). */
export const assistantCategoriesQueryKey = (params: AssistantCategoriesParams): string =>
  stableQueryKey(params);

export interface AssistantIdentifiersParams {
  source?: AssistantMarketSource;
}

/** Entry key of the identifiers lookup of one source. */
export const assistantIdentifiersQueryKey = (params: AssistantIdentifiersParams): string =>
  stableQueryKey(params);

/**
 * Assistant market list, one entry per query (`assistantListMap[queryKey]`).
 * The response already carries everything a row reader needs (`items`,
 * `currentPage`, `pageSize`, `totalCount`, and the optional `categoryCounts`),
 * so it is stored as-is.
 */
export const assistantListResource = defineReplica<AssistantListParams, AssistantListResponse>({
  fetcher: (params) => discoverService.getAssistantList(params),
  key: assistantListQueryKey,
  name: 'assistantList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One assistant detail by identifier / source / version (`assistantDetailMap[key]`).
 * The fetcher answers `undefined` for an identifier the market no longer has;
 * the default merge keeps whatever is already cached in that case, and an empty
 * slot stays empty so the page can render "not found" once the sync settles.
 */
export const assistantDetailResource = defineReplica<
  AssistantDetailParams,
  DiscoverAssistantDetail,
  DiscoverAssistantDetail | undefined
>({
  fetcher: (params) => discoverService.getAssistantDetail(params),
  key: assistantDetailQueryKey,
  name: 'assistantDetail',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Category counts of one query (`assistantCategoriesMap[queryKey]`). Small and
 * read on almost every community screen, so localStorage keeps the first frame
 * populated instead of flashing an empty sidebar.
 */
export const assistantCategoriesResource = defineReplica<AssistantCategoriesParams, CategoryItem[]>(
  {
    fetcher: (params) => discoverService.getAssistantCategories(params),
    key: assistantCategoriesQueryKey,
    name: 'assistantCategories',
    storage: 'localStorage',
    version: 1,
  },
);

/** The identifier index of one market source (`assistantIdentifiersMap[queryKey]`). */
export const assistantIdentifiersResource = defineReplica<
  AssistantIdentifiersParams,
  IdentifiersResponse
>({
  fetcher: (params) => discoverService.getAssistantIdentifiers(params),
  key: assistantIdentifiersQueryKey,
  name: 'assistantIdentifiers',
  storage: 'localStorage',
  version: 1,
});

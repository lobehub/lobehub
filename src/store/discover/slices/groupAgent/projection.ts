import type { CategoryItem, CategoryListQuery } from '@lobehub/market-sdk';

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import type {
  DiscoverGroupAgentDetail,
  GroupAgentListResponse,
  GroupAgentQueryParams,
  IdentifiersResponse,
} from '@/types/discover';

/**
 * The marketplace group-agent reads are **read-only**: no optimistic write, no
 * cross-copy entity link. What the replica buys here is the first frame — the
 * last confirmed page paints before the network answers — and one cache
 * partition per identity (the `cacheScope`), so switching account or workspace
 * never serves the previous one's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces: the community list paginates by URL (`?page=N`), so a page flip is
 * a different entry rather than a `loadMore` of the same one.
 */

/** Normalized `groupAgentList` params — the shape actually sent to the market endpoint. */
export interface GroupAgentListParams extends Omit<GroupAgentQueryParams, 'page' | 'pageSize'> {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
  page: number;
  pageSize: number;
}

/**
 * Entry key of one group-agent list query. Includes the page, because the list
 * pages through the URL instead of appending pages to one entry.
 */
export const groupAgentListQueryKey = (params: GroupAgentListParams): string =>
  stableQueryKey(params);

export interface GroupAgentDetailParams {
  identifier: string;
  /** Current UI language; the market resolves localized copy server-side. */
  locale?: string;
  version?: string;
}

/** Entry key of one group-agent detail (`identifier` + version, localized). */
export const groupAgentDetailQueryKey = (params: GroupAgentDetailParams): string =>
  stableQueryKey(params);

export interface GroupAgentCategoriesParams extends CategoryListQuery {
  /** Current UI language; the market resolves localized category labels. */
  locale?: string;
}

/** Entry key of one category-counts query (the search term). */
export const groupAgentCategoriesQueryKey = (params: GroupAgentCategoriesParams): string =>
  stableQueryKey(params);

/** The group-agent identifier index takes no query — one entry for the whole index. */
export type GroupAgentIdentifiersParams = Record<string, never>;

/** Entry key of the group-agent identifier index. */
export const groupAgentIdentifiersQueryKey = (params: GroupAgentIdentifiersParams = {}): string =>
  stableQueryKey(params);

/**
 * Group-agent market list, one entry per query (`groupAgentListMap[queryKey]`).
 * The response already carries everything a row reader needs (`items`,
 * `currentPage`, `pageSize`, `totalCount`, `totalPages`), so it is stored as-is.
 */
export const groupAgentListResource = defineReplica<GroupAgentListParams, GroupAgentListResponse>({
  fetcher: (params) => discoverService.getGroupAgentList(params),
  key: groupAgentListQueryKey,
  name: 'groupAgentList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One group-agent detail by identifier / version (`groupAgentDetailMap[key]`).
 * The fetcher answers `undefined` for an identifier the market no longer has;
 * the default merge keeps whatever is already cached in that case, and an empty
 * slot stays empty so the page can render "not found" once the sync settles.
 */
export const groupAgentDetailResource = defineReplica<
  GroupAgentDetailParams,
  DiscoverGroupAgentDetail,
  DiscoverGroupAgentDetail | undefined
>({
  fetcher: (params) => discoverService.getGroupAgentDetail(params),
  key: groupAgentDetailQueryKey,
  name: 'groupAgentDetail',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Category counts of one query (`groupAgentCategoriesMap[queryKey]`). Small and
 * read on almost every community group screen, so localStorage keeps the first
 * frame populated instead of flashing an empty sidebar.
 */
export const groupAgentCategoriesResource = defineReplica<
  GroupAgentCategoriesParams,
  CategoryItem[]
>({
  fetcher: (params) => discoverService.getGroupAgentCategories(params),
  key: groupAgentCategoriesQueryKey,
  name: 'groupAgentCategories',
  storage: 'localStorage',
  version: 1,
});

/** The group-agent identifier index (`groupAgentIdentifiersMap[queryKey]`). */
export const groupAgentIdentifiersResource = defineReplica<
  GroupAgentIdentifiersParams,
  IdentifiersResponse
>({
  fetcher: () => discoverService.getGroupAgentIdentifiers(),
  key: groupAgentIdentifiersQueryKey,
  name: 'groupAgentIdentifiers',
  storage: 'localStorage',
  version: 1,
});

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import type {
  DiscoverProviderDetail,
  IdentifiersResponse,
  ProviderListResponse,
  ProviderQueryParams,
} from '@/types/discover';

/**
 * The marketplace provider reads are **read-only**: no optimistic write, no
 * cross-copy entity link. What the replica buys here is the first frame — the
 * last confirmed page paints before the network answers — and one cache
 * partition per identity (the `cacheScope`), so switching account or workspace
 * never serves the previous one's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces: the community list paginates by URL (`?page=N`), so a page flip is
 * a different entry rather than a `loadMore` of the same one.
 */

/** Normalized `providerList` params — the shape actually sent to the market endpoint. */
export interface ProviderListParams extends Omit<ProviderQueryParams, 'page' | 'pageSize'> {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
  page: number;
  pageSize: number;
}

/**
 * Entry key of one provider list query. Includes the page, because the list
 * pages through the URL instead of appending pages to one entry.
 */
export const providerListQueryKey = (params: ProviderListParams): string => stableQueryKey(params);

export interface ProviderDetailParams {
  identifier: string;
  /** Current UI language; the market resolves localized copy server-side. */
  locale?: string;
  /** Ask the market to inline the provider readme in the detail. */
  withReadme?: boolean;
}

/** Entry key of one provider detail (`identifier`, localized, readme or not). */
export const providerDetailQueryKey = (params: ProviderDetailParams): string =>
  stableQueryKey(params);

/** The provider identifier index takes no query — one entry for the whole index. */
export type ProviderIdentifiersParams = Record<string, never>;

/** Entry key of the provider identifier index. */
export const providerIdentifiersQueryKey = (params: ProviderIdentifiersParams = {}): string =>
  stableQueryKey(params);

/**
 * Provider market list, one entry per query (`providerListMap[queryKey]`). The
 * response already carries everything a row reader needs (`items`,
 * `currentPage`, `pageSize`, `totalCount`), so it is stored as-is.
 */
export const providerListResource = defineReplica<ProviderListParams, ProviderListResponse>({
  fetcher: (params) => discoverService.getProviderList(params),
  key: providerListQueryKey,
  name: 'providerList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One provider detail by identifier (`providerDetailMap[key]`). The fetcher
 * answers `undefined` for an identifier the market no longer has; the default
 * merge keeps whatever is already cached in that case, and an empty slot stays
 * empty so the page can render "not found" once the sync settles.
 */
export const providerDetailResource = defineReplica<
  ProviderDetailParams,
  DiscoverProviderDetail,
  DiscoverProviderDetail | undefined
>({
  fetcher: (params) => discoverService.getProviderDetail(params),
  key: providerDetailQueryKey,
  name: 'providerDetail',
  storage: 'indexedDB',
  version: 1,
});

/** The provider identifier index (`providerIdentifiersMap[queryKey]`). */
export const providerIdentifiersResource = defineReplica<
  ProviderIdentifiersParams,
  IdentifiersResponse
>({
  fetcher: () => discoverService.getProviderIdentifiers(),
  key: providerIdentifiersQueryKey,
  name: 'providerIdentifiers',
  storage: 'localStorage',
  version: 1,
});

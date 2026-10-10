import type { CategoryItem, CategoryListQuery } from '@lobehub/market-sdk';

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import type {
  DiscoverModelDetail,
  IdentifiersResponse,
  ModelListResponse,
  ModelQueryParams,
} from '@/types/discover';

/**
 * The marketplace model reads are **read-only**: no optimistic write, no
 * cross-copy entity link. What the replica buys here is the first frame — the
 * last confirmed page paints before the network answers — and one cache
 * partition per identity (the `cacheScope`), so switching account or workspace
 * never serves the previous one's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces: the community list paginates by URL (`?page=N`), so a page flip is
 * a different entry rather than a `loadMore` of the same one.
 */

/** Normalized `modelList` params — the shape actually sent to the market endpoint. */
export interface ModelListParams extends Omit<ModelQueryParams, 'page' | 'pageSize'> {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
  page: number;
  pageSize: number;
}

/**
 * Entry key of one model list query. Includes the page, because the list pages
 * through the URL instead of appending pages to one entry.
 */
export const modelListQueryKey = (params: ModelListParams): string => stableQueryKey(params);

export interface ModelDetailParams {
  identifier: string;
  /** Current UI language; the market resolves localized copy server-side. */
  locale?: string;
}

/** Entry key of one model detail (`identifier`, localized). */
export const modelDetailQueryKey = (params: ModelDetailParams): string => stableQueryKey(params);

/** Category counts query of the community model sidebar (the search term). */
export type ModelCategoriesParams = CategoryListQuery;

/** Entry key of one category-counts query (the search term). */
export const modelCategoriesQueryKey = (params: ModelCategoriesParams): string =>
  stableQueryKey(params);

/** The model identifier index takes no query — one entry for the whole index. */
export type ModelIdentifiersParams = Record<string, never>;

/** Entry key of the model identifier index. */
export const modelIdentifiersQueryKey = (params: ModelIdentifiersParams = {}): string =>
  stableQueryKey(params);

/**
 * Model market list, one entry per query (`modelListMap[queryKey]`). The
 * response already carries everything a row reader needs (`items`,
 * `currentPage`, `pageSize`, `totalCount`), so it is stored as-is.
 */
export const modelListResource = defineReplica<ModelListParams, ModelListResponse>({
  fetcher: (params) => discoverService.getModelList(params),
  key: modelListQueryKey,
  name: 'modelList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One model detail by identifier (`modelDetailMap[key]`).
 *
 * Wrapped in an object on purpose: the engine drops an `undefined` fetch result
 * (and reads `null` as "keep the current value"), so a bare detail could never
 * clear a cached copy of a model the market has since removed. `{ model: null }`
 * is a real value that replaces it, and the page tells "the market answered not
 * found" apart from "nothing loaded yet" (no entry at all).
 */
export interface ModelDetailValue {
  /** The detail, or `null` when the market has no such identifier. */
  model: DiscoverModelDetail | null;
}

export const modelDetailResource = defineReplica<ModelDetailParams, ModelDetailValue>({
  fetcher: async (params) => ({
    model: (await discoverService.getModelDetail(params)) ?? null,
  }),
  key: modelDetailQueryKey,
  name: 'modelDetail',
  storage: 'indexedDB',
  // v2: the value is wrapped in `ModelDetailValue`; v1 stored the bare detail.
  version: 2,
});

/**
 * Category counts of one query (`modelCategoriesMap[queryKey]`). Small and read
 * on almost every community model screen, so localStorage keeps the first frame
 * populated instead of flashing an empty sidebar.
 */
export const modelCategoriesResource = defineReplica<ModelCategoriesParams, CategoryItem[]>({
  fetcher: (params) => discoverService.getModelCategories(params),
  key: modelCategoriesQueryKey,
  name: 'modelCategories',
  storage: 'localStorage',
  version: 1,
});

/** The model identifier index (`modelIdentifiersMap[queryKey]`). */
export const modelIdentifiersResource = defineReplica<ModelIdentifiersParams, IdentifiersResponse>({
  fetcher: () => discoverService.getModelIdentifiers(),
  key: modelIdentifiersQueryKey,
  name: 'modelIdentifiers',
  storage: 'localStorage',
  version: 1,
});

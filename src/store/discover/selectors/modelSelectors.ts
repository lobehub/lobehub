import type { CategoryItem } from '@lobehub/market-sdk';

import type { DiscoverModelDetail, IdentifiersResponse, ModelListResponse } from '@/types/discover';

import type { DiscoverStore } from '../store';

const EMPTY_CATEGORIES: CategoryItem[] = [];

/**
 * Readers of the model market replicas. Every helper takes the `queryKey` the
 * matching fetch hook returned, so a surface that asks for one query never
 * reads another's rows.
 */
const modelList =
  (queryKey?: string) =>
  (s: DiscoverStore): ModelListResponse | undefined =>
    queryKey ? s.modelListMap[queryKey] : undefined;

const modelDetail =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverModelDetail | undefined =>
    (queryKey && s.modelDetailMap[queryKey]?.model) || undefined;

const modelCategories =
  (queryKey?: string) =>
  (s: DiscoverStore): CategoryItem[] =>
    (queryKey && s.modelCategoriesMap[queryKey]) || EMPTY_CATEGORIES;

const modelIdentifiers =
  (queryKey?: string) =>
  (s: DiscoverStore): IdentifiersResponse | undefined =>
    queryKey ? s.modelIdentifiersMap[queryKey] : undefined;

export const modelSelectors = {
  modelCategories,
  modelDetail,
  modelIdentifiers,
  modelList,
};

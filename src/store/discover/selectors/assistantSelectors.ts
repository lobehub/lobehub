import type { CategoryItem } from '@lobehub/market-sdk';

import type {
  AssistantListResponse,
  DiscoverAssistantDetail,
  IdentifiersResponse,
} from '@/types/discover';

import type { DiscoverStore } from '../store';

const EMPTY_CATEGORIES: CategoryItem[] = [];

/**
 * Readers of the assistant market replicas. Every helper takes the `queryKey`
 * the matching fetch hook returned, so a surface that asks for one query never
 * reads another's rows.
 */
const assistantList =
  (queryKey?: string) =>
  (s: DiscoverStore): AssistantListResponse | undefined =>
    queryKey ? s.assistantListMap[queryKey] : undefined;

const assistantDetail =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverAssistantDetail | undefined =>
    queryKey ? s.assistantDetailMap[queryKey] : undefined;

const assistantCategories =
  (queryKey?: string) =>
  (s: DiscoverStore): CategoryItem[] =>
    (queryKey && s.assistantCategoriesMap[queryKey]) || EMPTY_CATEGORIES;

const assistantIdentifiers =
  (queryKey?: string) =>
  (s: DiscoverStore): IdentifiersResponse | undefined =>
    queryKey ? s.assistantIdentifiersMap[queryKey] : undefined;

export const assistantSelectors = {
  assistantCategories,
  assistantDetail,
  assistantIdentifiers,
  assistantList,
};

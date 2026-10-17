import type { CategoryItem } from '@lobehub/market-sdk';

import type {
  DiscoverGroupAgentDetail,
  GroupAgentListResponse,
  IdentifiersResponse,
} from '@/types/discover';

import type { DiscoverStore } from '../store';

const EMPTY_CATEGORIES: CategoryItem[] = [];

/**
 * Readers of the group-agent market replicas. Every helper takes the `queryKey`
 * the matching fetch hook returned, so a surface that asks for one query never
 * reads another's rows.
 */
const groupAgentList =
  (queryKey?: string) =>
  (s: DiscoverStore): GroupAgentListResponse | undefined =>
    queryKey ? s.groupAgentListMap[queryKey] : undefined;

const groupAgentDetail =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverGroupAgentDetail | undefined =>
    queryKey ? s.groupAgentDetailMap[queryKey] : undefined;

const groupAgentCategories =
  (queryKey?: string) =>
  (s: DiscoverStore): CategoryItem[] =>
    (queryKey && s.groupAgentCategoriesMap[queryKey]) || EMPTY_CATEGORIES;

const groupAgentIdentifiers =
  (queryKey?: string) =>
  (s: DiscoverStore): IdentifiersResponse | undefined =>
    queryKey ? s.groupAgentIdentifiersMap[queryKey] : undefined;

export const groupAgentSelectors = {
  groupAgentCategories,
  groupAgentDetail,
  groupAgentIdentifiers,
  groupAgentList,
};

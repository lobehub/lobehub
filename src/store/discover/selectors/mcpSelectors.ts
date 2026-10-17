import type { CategoryItem } from '@lobehub/market-sdk';

import type { DiscoverMcpDetail, McpListResponse } from '@/types/discover';

import type { DiscoverStore } from '../store';

const EMPTY_CATEGORIES: CategoryItem[] = [];

/**
 * Readers of the MCP market replicas. Every helper takes the `queryKey` the
 * matching fetch hook returned, so a surface that asks for one query never
 * reads another's rows.
 */
const mcpList =
  (queryKey?: string) =>
  (s: DiscoverStore): McpListResponse | undefined =>
    queryKey ? s.mcpListMap[queryKey] : undefined;

const mcpDetail =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverMcpDetail | undefined =>
    queryKey ? s.mcpDetailMap[queryKey] : undefined;

const mcpCategories =
  (queryKey?: string) =>
  (s: DiscoverStore): CategoryItem[] =>
    (queryKey && s.mcpCategoriesMap[queryKey]) || EMPTY_CATEGORIES;

export const mcpSelectors = {
  mcpCategories,
  mcpDetail,
  mcpList,
};

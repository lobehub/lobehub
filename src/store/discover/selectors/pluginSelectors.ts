import type { CategoryItem } from '@lobehub/market-sdk';

import type {
  DiscoverPluginDetail,
  IdentifiersResponse,
  PluginListResponse,
} from '@/types/discover';

import type { DiscoverStore } from '../store';

const EMPTY_CATEGORIES: CategoryItem[] = [];

/**
 * Readers of the plugin market replicas. Every helper takes the `queryKey` the
 * matching fetch hook returned, so a surface that asks for one query never
 * reads another's rows.
 */
const pluginList =
  (queryKey?: string) =>
  (s: DiscoverStore): PluginListResponse | undefined =>
    queryKey ? s.pluginListMap[queryKey] : undefined;

const pluginDetail =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverPluginDetail | undefined =>
    queryKey ? s.pluginDetailMap[queryKey] : undefined;

const pluginCategories =
  (queryKey?: string) =>
  (s: DiscoverStore): CategoryItem[] =>
    (queryKey && s.pluginCategoriesMap[queryKey]) || EMPTY_CATEGORIES;

const pluginIdentifiers =
  (queryKey?: string) =>
  (s: DiscoverStore): IdentifiersResponse | undefined =>
    queryKey ? s.pluginIdentifiersMap[queryKey] : undefined;

export const pluginSelectors = {
  pluginCategories,
  pluginDetail,
  pluginIdentifiers,
  pluginList,
};

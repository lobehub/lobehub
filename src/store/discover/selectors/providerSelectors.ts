import type {
  DiscoverProviderDetail,
  IdentifiersResponse,
  ProviderListResponse,
} from '@/types/discover';

import type { DiscoverStore } from '../store';

/**
 * Readers of the provider market replicas. Every helper takes the `queryKey`
 * the matching fetch hook returned, so a surface that asks for one query never
 * reads another's rows.
 */
const providerList =
  (queryKey?: string) =>
  (s: DiscoverStore): ProviderListResponse | undefined =>
    queryKey ? s.providerListMap[queryKey] : undefined;

const providerDetail =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverProviderDetail | undefined =>
    queryKey ? s.providerDetailMap[queryKey] : undefined;

const providerIdentifiers =
  (queryKey?: string) =>
  (s: DiscoverStore): IdentifiersResponse | undefined =>
    queryKey ? s.providerIdentifiersMap[queryKey] : undefined;

export const providerSelectors = {
  providerDetail,
  providerIdentifiers,
  providerList,
};

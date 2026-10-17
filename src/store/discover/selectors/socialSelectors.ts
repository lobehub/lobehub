import {
  type FavoriteAgentItem,
  type FavoritePluginItem,
  type FollowCounts,
  type FollowStatus,
  type FollowUserItem,
  type PaginatedResponse,
} from '@/services/social';

import type { DiscoverStore } from '../store';

/**
 * Readers of the social replicas. Every helper takes the `queryKey` the
 * matching fetch hook returned, so a surface that asks for one entry never
 * reads another's value.
 */
const followStatus =
  (queryKey?: string) =>
  (s: DiscoverStore): FollowStatus | undefined =>
    queryKey ? s.followStatusMap[queryKey] : undefined;

const followCounts =
  (queryKey?: string) =>
  (s: DiscoverStore): FollowCounts | undefined =>
    queryKey ? s.followCountsMap[queryKey] : undefined;

const followers =
  (queryKey?: string) =>
  (s: DiscoverStore): PaginatedResponse<FollowUserItem> | undefined =>
    queryKey ? s.followersMap[queryKey] : undefined;

const following =
  (queryKey?: string) =>
  (s: DiscoverStore): PaginatedResponse<FollowUserItem> | undefined =>
    queryKey ? s.followingMap[queryKey] : undefined;

const favoriteAgents =
  (queryKey?: string) =>
  (s: DiscoverStore): PaginatedResponse<FavoriteAgentItem> | undefined =>
    queryKey ? s.favoriteAgentsMap[queryKey] : undefined;

const favoritePlugins =
  (queryKey?: string) =>
  (s: DiscoverStore): PaginatedResponse<FavoritePluginItem> | undefined =>
    queryKey ? s.favoritePluginsMap[queryKey] : undefined;

export const socialSelectors = {
  favoriteAgents,
  favoritePlugins,
  followCounts,
  followStatus,
  followers,
  following,
};

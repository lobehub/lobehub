import { defineReplica, stableQueryKey } from '@/libs/replica';
import {
  type FavoriteAgentItem,
  type FavoritePluginItem,
  type FollowCounts,
  type FollowStatus,
  type FollowUserItem,
  type PaginatedResponse,
} from '@/services/social';
import { socialService } from '@/services/social';

/**
 * The social reads are **per viewer** and mostly read-only: the community
 * profile paints the last confirmed follow state / counts / lists before the
 * network answers, and one cache partition per identity (`cacheScope`) keeps a
 * signed-in viewer from reading another account's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces — the follow status and counts are keyed by the target user, the
 * paged lists by target user plus page / page size.
 */

/** A viewer-relative read addressed by the target user (status, counts). */
export interface SocialUserParams {
  userId: number;
}

/** One page of a user's followers / following / favorites. */
export interface SocialListParams {
  page?: number;
  pageSize?: number;
  userId: number;
}

/** Entry key of a per-user read (`followStatusMap[userId]`). */
export const socialUserKey = ({ userId }: SocialUserParams): string => String(userId);

/** Entry key of one page of a user's list — user, page and page size all matter. */
export const socialListKey = (params: SocialListParams): string => stableQueryKey(params);

/** Whether the viewer follows the target user (`followStatusMap[key]`). */
export const followStatusResource = defineReplica<SocialUserParams, FollowStatus>({
  fetcher: ({ userId }) => socialService.checkFollowStatus(userId),
  key: socialUserKey,
  name: 'discoverFollowStatus',
  storage: 'indexedDB',
  version: 1,
});

/** The target user's follower / following counts (`followCountsMap[key]`). */
export const followCountsResource = defineReplica<SocialUserParams, FollowCounts>({
  fetcher: ({ userId }) => socialService.getFollowCounts(userId),
  key: socialUserKey,
  name: 'discoverFollowCounts',
  storage: 'indexedDB',
  version: 1,
});

/** A user's followers (`followersMap[key]`). */
export const followersResource = defineReplica<SocialListParams, PaginatedResponse<FollowUserItem>>(
  {
    fetcher: ({ page, pageSize, userId }) => socialService.getFollowers(userId, { page, pageSize }),
    key: socialListKey,
    name: 'discoverFollowers',
    storage: 'indexedDB',
    version: 1,
  },
);

/** A user's following (`followingMap[key]`). */
export const followingResource = defineReplica<SocialListParams, PaginatedResponse<FollowUserItem>>(
  {
    fetcher: ({ page, pageSize, userId }) => socialService.getFollowing(userId, { page, pageSize }),
    key: socialListKey,
    name: 'discoverFollowing',
    storage: 'indexedDB',
    version: 1,
  },
);

/** A user's favorited agents (`favoriteAgentsMap[key]`). */
export const favoriteAgentsResource = defineReplica<
  SocialListParams,
  PaginatedResponse<FavoriteAgentItem>
>({
  fetcher: ({ page, pageSize, userId }) =>
    socialService.getUserFavoriteAgents(userId, { page, pageSize }),
  key: socialListKey,
  name: 'discoverFavoriteAgents',
  storage: 'indexedDB',
  version: 1,
});

/** A user's favorited plugins (`favoritePluginsMap[key]`). */
export const favoritePluginsResource = defineReplica<
  SocialListParams,
  PaginatedResponse<FavoritePluginItem>
>({
  fetcher: ({ page, pageSize, userId }) =>
    socialService.getUserFavoritePlugins(userId, { page, pageSize }),
  key: socialListKey,
  name: 'discoverFavoritePlugins',
  storage: 'indexedDB',
  version: 1,
});

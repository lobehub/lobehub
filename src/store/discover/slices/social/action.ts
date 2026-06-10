import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import {
  type FavoriteAgentItem,
  type FavoritePluginItem,
  type FollowCounts,
  type FollowStatus,
  type FollowUserItem,
  type PaginatedResponse,
  type SocialTargetType,
} from '@/services/social';
import { socialService } from '@/services/social';
import { type DiscoverStore } from '@/store/discover';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<DiscoverStore>;
export const createSocialSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new SocialActionImpl(set, get, _api);

const followStatusKey = (userId: number) => `follow-status-${userId}`;
const followCountsKey = (userId: number) => `follow-counts-${userId}`;

const optimisticFollowCounts =
  (isFollowing: boolean) =>
  (current?: FollowCounts): FollowCounts => {
    const followersCount = current?.followersCount ?? 0;

    return {
      followersCount: isFollowing ? followersCount + 1 : Math.max(0, followersCount - 1),
      followingCount: current?.followingCount ?? 0,
    };
  };

const updateFollowCaches = async (followingId: number, isFollowing: boolean) => {
  await Promise.all([
    mutate(
      followStatusKey(followingId),
      {
        isFollowing,
        isMutual: false,
      } satisfies FollowStatus,
      { revalidate: false },
    ),
    mutate(followCountsKey(followingId), optimisticFollowCounts(isFollowing), {
      revalidate: false,
    }),
    mutate(
      (key) =>
        typeof key === 'string' && (key.startsWith('followers-') || key.startsWith('following-')),
      undefined,
      {
        revalidate: true,
      },
    ),
  ]);
};

export class SocialActionImpl {
  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  addFavorite = async (targetType: SocialTargetType, targetId: number): Promise<void> => {
    await socialService.addFavorite(targetType, targetId);
    // Invalidate favorite-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('favorite-'), undefined, {
      revalidate: true,
    });
  };

  follow = async (followingId: number): Promise<void> => {
    await socialService.follow(followingId);
    await updateFollowCaches(followingId, true);
  };

  removeFavorite = async (targetType: SocialTargetType, targetId: number): Promise<void> => {
    await socialService.removeFavorite(targetType, targetId);
    // Invalidate favorite-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('favorite-'), undefined, {
      revalidate: true,
    });
  };

  toggleLike = async (
    targetType: SocialTargetType,
    targetId: number,
  ): Promise<{ liked: boolean }> => {
    const result = await socialService.toggleLike(targetType, targetId);
    // Invalidate like-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('liked-'), undefined, {
      revalidate: true,
    });
    return result;
  };

  unfollow = async (followingId: number): Promise<void> => {
    await socialService.unfollow(followingId);
    await updateFollowCaches(followingId, false);
  };

  useFavoriteAgents = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SWRResponse<PaginatedResponse<FavoriteAgentItem>> => {
    return useSWR(
      userId ? ['favorite-agents', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getUserFavoriteAgents(userId!, params),
      { revalidateOnFocus: false },
    );
  };

  useFavoritePlugins = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SWRResponse<PaginatedResponse<FavoritePluginItem>> => {
    return useSWR(
      userId ? ['favorite-plugins', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getUserFavoritePlugins(userId!, params),
      { revalidateOnFocus: false },
    );
  };

  useFollowCounts = (userId: number | undefined): SWRResponse<FollowCounts> => {
    return useSWR(
      userId ? ['follow-counts', userId].join('-') : null,
      async () => socialService.getFollowCounts(userId!),
      { revalidateOnFocus: false },
    );
  };

  useFollowStatus = (userId: number | undefined): SWRResponse<FollowStatus> => {
    return useSWR(
      userId ? ['follow-status', userId].join('-') : null,
      async () => socialService.checkFollowStatus(userId!),
      { revalidateOnFocus: false },
    );
  };

  useFollowers = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SWRResponse<PaginatedResponse<FollowUserItem>> => {
    return useSWR(
      userId ? ['followers', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getFollowers(userId!, params),
      { revalidateOnFocus: false },
    );
  };

  useFollowing = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SWRResponse<PaginatedResponse<FollowUserItem>> => {
    return useSWR(
      userId ? ['following', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getFollowing(userId!, params),
      { revalidateOnFocus: false },
    );
  };
}

export type SocialAction = Pick<SocialActionImpl, keyof SocialActionImpl>;

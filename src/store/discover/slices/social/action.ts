import useSWR, { type SWRResponse, mutate } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import {
  type FavoriteAgentItem,
  type FavoritePluginItem,
  type FollowCounts,
  type FollowStatus,
  type FollowUserItem,
  type PaginatedResponse,
  type SocialTargetType,
  socialService,
} from '@/services/social';
import { type DiscoverStore } from '@/store/discover';

export interface SocialAction {
  // Favorite actions
  addFavorite: (targetType: SocialTargetType, targetId: number) => Promise<void>;
  // Follow actions
  follow: (followingId: number) => Promise<void>;

  removeFavorite: (targetType: SocialTargetType, targetId: number) => Promise<void>;
  // Like actions
  toggleLike: (targetType: SocialTargetType, targetId: number) => Promise<{ liked: boolean }>;

  unfollow: (followingId: number) => Promise<void>;

  // Favorite queries
  useFavoriteAgents: (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ) => SWRResponse<PaginatedResponse<FavoriteAgentItem>>;
  useFavoritePlugins: (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ) => SWRResponse<PaginatedResponse<FavoritePluginItem>>;
  useFollowCounts: (userId: number | undefined) => SWRResponse<FollowCounts>;
  // Follow queries
  useFollowStatus: (userId: number | undefined) => SWRResponse<FollowStatus>;

  useFollowers: (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ) => SWRResponse<PaginatedResponse<FollowUserItem>>;
  useFollowing: (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ) => SWRResponse<PaginatedResponse<FollowUserItem>>;
}

export const createSocialSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  SocialAction
> = () => ({
  
  // Favorite actions
addFavorite: async (targetType, targetId) => {
    await socialService.addFavorite(targetType, targetId);
    // Invalidate favorite-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('favorite-'), undefined, {
      revalidate: true,
    });
  },

  
// Follow actions
follow: async (followingId) => {
    await socialService.follow(followingId);
    // Invalidate follow-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('follow-'), undefined, {
      revalidate: true,
    });
  },

  
  removeFavorite: async (targetType, targetId) => {
    await socialService.removeFavorite(targetType, targetId);
    // Invalidate favorite-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('favorite-'), undefined, {
      revalidate: true,
    });
  },

  // Like actions
toggleLike: async (targetType, targetId) => {
    const result = await socialService.toggleLike(targetType, targetId);
    // Invalidate like-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('liked-'), undefined, {
      revalidate: true,
    });
    return result;
  },

  
  unfollow: async (followingId) => {
    await socialService.unfollow(followingId);
    // Invalidate follow-related caches
    await mutate((key) => typeof key === 'string' && key.startsWith('follow-'), undefined, {
      revalidate: true,
    });
  },

  
  // Favorite queries
useFavoriteAgents: (userId, params) => {
    return useSWR(
      userId ? ['favorite-agents', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getUserFavoriteAgents(userId!, params),
      { revalidateOnFocus: false },
    );
  },

  

useFavoritePlugins: (userId, params) => {
    return useSWR(
      userId ? ['favorite-plugins', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getUserFavoritePlugins(userId!, params),
      { revalidateOnFocus: false },
    );
  },

  

useFollowCounts: (userId) => {
    return useSWR(
      userId ? ['follow-counts', userId].join('-') : null,
      async () => socialService.getFollowCounts(userId!),
      { revalidateOnFocus: false },
    );
  },

  
// Follow queries
useFollowStatus: (userId) => {
    return useSWR(
      userId ? ['follow-status', userId].join('-') : null,
      async () => socialService.checkFollowStatus(userId!),
      { revalidateOnFocus: false },
    );
  },

  
  useFollowers: (userId, params) => {
    return useSWR(
      userId ? ['followers', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getFollowers(userId!, params),
      { revalidateOnFocus: false },
    );
  },

  useFollowing: (userId, params) => {
    return useSWR(
      userId ? ['following', userId, params?.page, params?.pageSize].join('-') : null,
      async () => socialService.getFollowing(userId!, params),
      { revalidateOnFocus: false },
    );
  },
});

import { lambdaClient } from '@/libs/trpc/client';

export type SocialTargetType = 'agent' | 'plugin' | 'agent-group';

export interface FollowStatus {
  isFollowing: boolean;
  isMutual: boolean;
}

export interface FollowCounts {
  followersCount: number;
  followingCount: number;
}

export interface FavoriteStatus {
  isFavorited: boolean;
}

export interface LikeStatus {
  isLiked: boolean;
}

export interface ToggleLikeResult {
  liked: boolean;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  currentPage: number;
  items: T[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface FollowUserItem {
  avatarUrl: string | null;
  displayName: string | null;
  id: number;
  namespace: string;
  userName: string | null;
}

export interface FavoriteItem {
  createdAt: string;
  id: number;
  targetId: number;
  targetType: SocialTargetType;
}

export interface FavoriteAgentItem {
  avatar: string;
  category: string;
  createdAt: string;
  description: string;
  identifier: string;
  installCount?: number;
  name: string;
  tags: string[];
}

export interface FavoritePluginItem {
  avatar: string;
  category: string;
  createdAt: string;
  description: string;
  identifier: string;
  name: string;
  tags: string[];
}

class SocialService {
  /**
   * @deprecated This method is no longer needed as authentication is now handled
   * automatically through tRPC middleware. Keeping for backward compatibility.
   */
   
  setAccessToken(_token: string | undefined) {
    // No-op: Authentication is now handled through tRPC authedProcedure middleware
  }

  // ==================== Follow ====================

  async follow(followingId: number): Promise<void> {
    await lambdaClient.market.social.follow.mutate({ followingId });
  }

  async unfollow(followingId: number): Promise<void> {
    await lambdaClient.market.social.unfollow.mutate({ followingId });
  }

  async checkFollowStatus(userId: number): Promise<FollowStatus> {
    return lambdaClient.market.social.checkFollowStatus.query({
      targetUserId: userId,
    }) as Promise<FollowStatus>;
  }

  async getFollowCounts(userId: number): Promise<FollowCounts> {
    return lambdaClient.market.social.getFollowCounts.query({
      userId,
    }) as Promise<FollowCounts>;
  }

  async getFollowing(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FollowUserItem>> {
    return lambdaClient.market.social.getFollowing.query({
      limit: params?.pageSize,
      offset: params?.page ? (params.page - 1) * (params.pageSize || 10) : undefined,
      userId,
    }) as unknown as Promise<PaginatedResponse<FollowUserItem>>;
  }

  async getFollowers(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FollowUserItem>> {
    return lambdaClient.market.social.getFollowers.query({
      limit: params?.pageSize,
      offset: params?.page ? (params.page - 1) * (params.pageSize || 10) : undefined,
      userId,
    }) as unknown as Promise<PaginatedResponse<FollowUserItem>>;
  }

  // ==================== Favorite ====================

  async addFavorite(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<void> {
    const input =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await lambdaClient.market.social.addFavorite.mutate(input);
  }

  async removeFavorite(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<void> {
    const input =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await lambdaClient.market.social.removeFavorite.mutate(input);
  }

  async checkFavoriteStatus(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<FavoriteStatus> {
    return lambdaClient.market.social.checkFavorite.query({
      targetIdOrIdentifier,
      targetType,
    }) as Promise<FavoriteStatus>;
  }

  async getMyFavorites(params?: PaginationParams): Promise<PaginatedResponse<FavoriteItem>> {
    return lambdaClient.market.social.getMyFavorites.query({
      limit: params?.pageSize,
      offset: params?.page ? (params.page - 1) * (params.pageSize || 10) : undefined,
    }) as unknown as Promise<PaginatedResponse<FavoriteItem>>;
  }

  async getUserFavoriteAgents(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoriteAgentItem>> {
    return lambdaClient.market.social.getUserFavoriteAgents.query({
      limit: params?.pageSize,
      offset: params?.page ? (params.page - 1) * (params.pageSize || 10) : undefined,
      userId,
    }) as unknown as Promise<PaginatedResponse<FavoriteAgentItem>>;
  }

  async getUserFavoritePlugins(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoritePluginItem>> {
    return lambdaClient.market.social.getUserFavoritePlugins.query({
      limit: params?.pageSize,
      offset: params?.page ? (params.page - 1) * (params.pageSize || 10) : undefined,
      userId,
    }) as unknown as Promise<PaginatedResponse<FavoritePluginItem>>;
  }

  // ==================== Like ====================

  async like(targetType: SocialTargetType, targetIdOrIdentifier: number | string): Promise<void> {
    const input =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await lambdaClient.market.social.like.mutate(input);
  }

  async unlike(targetType: SocialTargetType, targetIdOrIdentifier: number | string): Promise<void> {
    const input =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await lambdaClient.market.social.unlike.mutate(input);
  }

  async checkLikeStatus(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<LikeStatus> {
    return lambdaClient.market.social.checkLike.query({
      targetIdOrIdentifier,
      targetType,
    }) as Promise<LikeStatus>;
  }

  async toggleLike(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<ToggleLikeResult> {
    const input =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    return lambdaClient.market.social.toggleLike.mutate(input) as Promise<ToggleLikeResult>;
  }

  async getUserLikedAgents(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoriteAgentItem>> {
    return lambdaClient.market.social.getUserLikedAgents.query({
      limit: params?.pageSize,
      offset: params?.page ? (params.page - 1) * (params.pageSize || 10) : undefined,
      userId,
    }) as unknown as Promise<PaginatedResponse<FavoriteAgentItem>>;
  }

  async getUserLikedPlugins(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoritePluginItem>> {
    return lambdaClient.market.social.getUserLikedPlugins.query({
      limit: params?.pageSize,
      offset: params?.page ? (params.page - 1) * (params.pageSize || 10) : undefined,
      userId,
    }) as unknown as Promise<PaginatedResponse<FavoritePluginItem>>;
  }
}

export const socialService = new SocialService();

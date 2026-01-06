import { MARKET_ENDPOINTS } from '@/services/_url';

export type SocialTargetType = 'agent' | 'plugin';

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
  private accessToken?: string;

  // eslint-disable-next-line no-undef
  private async request<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);

    if (init?.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    if (this.accessToken && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${this.accessToken}`);
    }

    const response = await fetch(endpoint, {
      ...init,
      credentials: init?.credentials ?? 'same-origin',
      headers,
    });

    if (!response.ok) {
      let message = 'Unknown error';

      try {
        const errorBody = await response.json();
        message = errorBody?.message ?? message;
      } catch {
        message = await response.text();
      }

      throw new Error(message || 'Social request failed');
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  setAccessToken(token: string | undefined) {
    this.accessToken = token;
  }

  // ==================== Follow ====================

  async follow(followingId: number): Promise<void> {
    await this.request(MARKET_ENDPOINTS.follow, {
      body: JSON.stringify({ followingId }),
      method: 'POST',
    });
  }

  async unfollow(followingId: number): Promise<void> {
    await this.request(MARKET_ENDPOINTS.unfollow, {
      body: JSON.stringify({ followingId }),
      method: 'POST',
    });
  }

  async checkFollowStatus(userId: number): Promise<FollowStatus> {
    return this.request(MARKET_ENDPOINTS.followStatus(userId), {
      method: 'GET',
    });
  }

  async getFollowCounts(userId: number): Promise<FollowCounts> {
    return this.request(MARKET_ENDPOINTS.followCounts(userId), {
      method: 'GET',
    });
  }

  async getFollowing(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FollowUserItem>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const queryString = searchParams.toString();
    const url = queryString
      ? `${MARKET_ENDPOINTS.following(userId)}?${queryString}`
      : MARKET_ENDPOINTS.following(userId);

    return this.request(url, { method: 'GET' });
  }

  async getFollowers(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FollowUserItem>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const queryString = searchParams.toString();
    const url = queryString
      ? `${MARKET_ENDPOINTS.followers(userId)}?${queryString}`
      : MARKET_ENDPOINTS.followers(userId);

    return this.request(url, { method: 'GET' });
  }

  // ==================== Favorite ====================

  async addFavorite(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<void> {
    const body =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await this.request(MARKET_ENDPOINTS.favorite, {
      body: JSON.stringify(body),
      method: 'POST',
    });
  }

  async removeFavorite(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<void> {
    const body =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await this.request(MARKET_ENDPOINTS.unfavorite, {
      body: JSON.stringify(body),
      method: 'POST',
    });
  }

  async checkFavoriteStatus(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<FavoriteStatus> {
    return this.request(MARKET_ENDPOINTS.favoriteStatus(targetType, targetIdOrIdentifier), {
      method: 'GET',
    });
  }

  async getMyFavorites(params?: PaginationParams): Promise<PaginatedResponse<FavoriteItem>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const queryString = searchParams.toString();
    const url = queryString
      ? `${MARKET_ENDPOINTS.myFavorites}?${queryString}`
      : MARKET_ENDPOINTS.myFavorites;

    return this.request(url, { method: 'GET' });
  }

  async getUserFavoriteAgents(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoriteAgentItem>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const queryString = searchParams.toString();
    const url = queryString
      ? `${MARKET_ENDPOINTS.favoriteAgents(userId)}?${queryString}`
      : MARKET_ENDPOINTS.favoriteAgents(userId);

    return this.request(url, { method: 'GET' });
  }

  async getUserFavoritePlugins(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoritePluginItem>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const queryString = searchParams.toString();
    const url = queryString
      ? `${MARKET_ENDPOINTS.favoritePlugins(userId)}?${queryString}`
      : MARKET_ENDPOINTS.favoritePlugins(userId);

    return this.request(url, { method: 'GET' });
  }

  // ==================== Like ====================

  async like(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<void> {
    const body =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await this.request(MARKET_ENDPOINTS.like, {
      body: JSON.stringify(body),
      method: 'POST',
    });
  }

  async unlike(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<void> {
    const body =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    await this.request(MARKET_ENDPOINTS.unlike, {
      body: JSON.stringify(body),
      method: 'POST',
    });
  }

  async checkLikeStatus(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<LikeStatus> {
    return this.request(MARKET_ENDPOINTS.likeStatus(targetType, targetIdOrIdentifier), {
      method: 'GET',
    });
  }

  async toggleLike(
    targetType: SocialTargetType,
    targetIdOrIdentifier: number | string,
  ): Promise<ToggleLikeResult> {
    const body =
      typeof targetIdOrIdentifier === 'string'
        ? { identifier: targetIdOrIdentifier, targetType }
        : { targetId: targetIdOrIdentifier, targetType };

    return this.request(MARKET_ENDPOINTS.toggleLike, {
      body: JSON.stringify(body),
      method: 'POST',
    });
  }

  async getUserLikedAgents(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoriteAgentItem>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const queryString = searchParams.toString();
    const url = queryString
      ? `${MARKET_ENDPOINTS.likedAgents(userId)}?${queryString}`
      : MARKET_ENDPOINTS.likedAgents(userId);

    return this.request(url, { method: 'GET' });
  }

  async getUserLikedPlugins(
    userId: number,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<FavoritePluginItem>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const queryString = searchParams.toString();
    const url = queryString
      ? `${MARKET_ENDPOINTS.likedPlugins(userId)}?${queryString}`
      : MARKET_ENDPOINTS.likedPlugins(userId);

    return this.request(url, { method: 'GET' });
  }
}

export const socialService = new SocialService();

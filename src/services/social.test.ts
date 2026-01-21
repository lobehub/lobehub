import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MARKET_ENDPOINTS } from '@/services/_url';

import {
  type FavoriteAgentItem,
  type FavoriteItem,
  type FavoritePluginItem,
  type FavoriteStatus,
  type FollowCounts,
  type FollowStatus,
  type FollowUserItem,
  type LikeStatus,
  type PaginatedResponse,
  type SocialTargetType,
  type ToggleLikeResult,
  socialService,
} from './social';

// Mock global fetch
global.fetch = vi.fn();

describe('SocialService', () => {
  const mockAccessToken = 'mock-access-token';

  beforeEach(() => {
    vi.clearAllMocks();
    socialService.setAccessToken(undefined);
  });

  describe('setAccessToken', () => {
    it('should set access token', () => {
      socialService.setAccessToken(mockAccessToken);

      // Verify token is set by making a request and checking the authorization header
      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: async () => ({ isFollowing: false, isMutual: false }),
        ok: true,
        status: 200,
      } as Response);

      socialService.checkFollowStatus(1);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.any(Headers),
        }),
      );

      const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Headers;
      expect(headers.get('authorization')).toBe(`Bearer ${mockAccessToken}`);
    });

    it('should clear access token when set to undefined', () => {
      socialService.setAccessToken(mockAccessToken);
      socialService.setAccessToken(undefined);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: async () => ({ isFollowing: false, isMutual: false }),
        ok: true,
        status: 200,
      } as Response);

      socialService.checkFollowStatus(1);

      const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Headers;
      expect(headers.get('authorization')).toBeNull();
    });
  });

  describe('request method', () => {
    beforeEach(() => {
      socialService.setAccessToken(mockAccessToken);
    });

    it('should set content-type header for JSON body', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: async () => ({}),
        ok: true,
        status: 200,
      } as Response);

      await socialService.follow(1);

      const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('should include authorization header when token is set', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: async () => ({}),
        ok: true,
        status: 200,
      } as Response);

      await socialService.follow(1);

      const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Headers;
      expect(headers.get('authorization')).toBe(`Bearer ${mockAccessToken}`);
    });

    it('should handle 204 No Content response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 204,
      } as Response);

      const result = await socialService.follow(1);

      expect(result).toBeUndefined();
    });

    it('should throw error on failed request with JSON error body', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: async () => ({ message: 'Custom error message' }),
        ok: false,
        status: 400,
      } as Response);

      await expect(socialService.follow(1)).rejects.toThrow('Custom error message');
    });

    it('should throw error with text body when JSON parsing fails', async () => {
      const mockResponse = {
        json: async () => {
          throw new Error('JSON parse error');
        },
        ok: false,
        status: 500,
        text: async () => 'Server error',
      };

      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as unknown as Response);

      await expect(socialService.follow(1)).rejects.toThrow('Server error');
    });

    it('should throw generic error when no error message is available', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: async () => ({}),
        ok: false,
        status: 500,
        text: async () => '',
      } as Response);

      await expect(socialService.follow(1)).rejects.toThrow('Unknown error');
    });

    it('should use same-origin credentials by default', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: async () => ({}),
        ok: true,
        status: 200,
      } as Response);

      await socialService.follow(1);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'same-origin',
        }),
      );
    });
  });

  describe('Follow operations', () => {
    beforeEach(() => {
      socialService.setAccessToken(mockAccessToken);
    });

    describe('follow', () => {
      it('should follow a user successfully', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        await socialService.follow(123);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.follow,
          expect.objectContaining({
            body: JSON.stringify({ followingId: 123 }),
            method: 'POST',
          }),
        );
      });
    });

    describe('unfollow', () => {
      it('should unfollow a user successfully', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        await socialService.unfollow(456);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.unfollow,
          expect.objectContaining({
            body: JSON.stringify({ followingId: 456 }),
            method: 'POST',
          }),
        );
      });
    });

    describe('checkFollowStatus', () => {
      it('should check follow status successfully', async () => {
        const mockStatus: FollowStatus = { isFollowing: true, isMutual: false };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockStatus,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.checkFollowStatus(789);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.followStatus(789),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockStatus);
      });

      it('should return mutual follow status', async () => {
        const mockStatus: FollowStatus = { isFollowing: true, isMutual: true };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockStatus,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.checkFollowStatus(101);

        expect(result.isMutual).toBe(true);
      });
    });

    describe('getFollowCounts', () => {
      it('should get follow counts successfully', async () => {
        const mockCounts: FollowCounts = { followersCount: 100, followingCount: 50 };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockCounts,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getFollowCounts(202);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.followCounts(202),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockCounts);
      });
    });

    describe('getFollowing', () => {
      it('should get following list without pagination params', async () => {
        const mockResponse: PaginatedResponse<FollowUserItem> = {
          currentPage: 1,
          items: [
            {
              avatarUrl: 'https://example.com/avatar.png',
              displayName: 'John Doe',
              id: 1,
              namespace: 'johndoe',
              userName: 'john',
            },
          ],
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getFollowing(303);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.following(303),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should get following list with pagination params', async () => {
        const mockResponse: PaginatedResponse<FollowUserItem> = {
          currentPage: 2,
          items: [],
          pageSize: 10,
          totalCount: 25,
          totalPages: 3,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getFollowing(404, { page: 2, pageSize: 10 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.following(404)}?page=2&pageSize=10`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should handle only page param', async () => {
        const mockResponse: PaginatedResponse<FollowUserItem> = {
          currentPage: 3,
          items: [],
          pageSize: 20,
          totalCount: 60,
          totalPages: 3,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        await socialService.getFollowing(505, { page: 3 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.following(505)}?page=3`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
      });

      it('should handle only pageSize param', async () => {
        const mockResponse: PaginatedResponse<FollowUserItem> = {
          currentPage: 1,
          items: [],
          pageSize: 50,
          totalCount: 100,
          totalPages: 2,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        await socialService.getFollowing(606, { pageSize: 50 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.following(606)}?pageSize=50`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
      });
    });

    describe('getFollowers', () => {
      it('should get followers list without pagination params', async () => {
        const mockResponse: PaginatedResponse<FollowUserItem> = {
          currentPage: 1,
          items: [
            {
              avatarUrl: null,
              displayName: 'Jane Smith',
              id: 2,
              namespace: 'janesmith',
              userName: null,
            },
          ],
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getFollowers(707);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.followers(707),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should get followers list with pagination params', async () => {
        const mockResponse: PaginatedResponse<FollowUserItem> = {
          currentPage: 2,
          items: [],
          pageSize: 15,
          totalCount: 30,
          totalPages: 2,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getFollowers(808, { page: 2, pageSize: 15 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.followers(808)}?page=2&pageSize=15`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });
    });
  });

  describe('Favorite operations', () => {
    beforeEach(() => {
      socialService.setAccessToken(mockAccessToken);
    });

    describe('addFavorite', () => {
      it('should add favorite with numeric targetId', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'agent';
        await socialService.addFavorite(targetType, 123);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.favorite,
          expect.objectContaining({
            body: JSON.stringify({ targetId: 123, targetType: 'agent' }),
            method: 'POST',
          }),
        );
      });

      it('should add favorite with string identifier', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'plugin';
        await socialService.addFavorite(targetType, 'my-plugin');

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.favorite,
          expect.objectContaining({
            body: JSON.stringify({ identifier: 'my-plugin', targetType: 'plugin' }),
            method: 'POST',
          }),
        );
      });
    });

    describe('removeFavorite', () => {
      it('should remove favorite with numeric targetId', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'agent';
        await socialService.removeFavorite(targetType, 456);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.unfavorite,
          expect.objectContaining({
            body: JSON.stringify({ targetId: 456, targetType: 'agent' }),
            method: 'POST',
          }),
        );
      });

      it('should remove favorite with string identifier', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'plugin';
        await socialService.removeFavorite(targetType, 'another-plugin');

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.unfavorite,
          expect.objectContaining({
            body: JSON.stringify({ identifier: 'another-plugin', targetType: 'plugin' }),
            method: 'POST',
          }),
        );
      });
    });

    describe('checkFavoriteStatus', () => {
      it('should check favorite status with numeric targetId', async () => {
        const mockStatus: FavoriteStatus = { isFavorited: true };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockStatus,
          ok: true,
          status: 200,
        } as Response);

        const targetType: SocialTargetType = 'agent';
        const result = await socialService.checkFavoriteStatus(targetType, 789);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.favoriteStatus(targetType, 789),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockStatus);
      });

      it('should check favorite status with string identifier', async () => {
        const mockStatus: FavoriteStatus = { isFavorited: false };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockStatus,
          ok: true,
          status: 200,
        } as Response);

        const targetType: SocialTargetType = 'plugin';
        const result = await socialService.checkFavoriteStatus(targetType, 'test-plugin');

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.favoriteStatus(targetType, 'test-plugin'),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockStatus);
      });
    });

    describe('getMyFavorites', () => {
      it('should get my favorites without pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoriteItem> = {
          currentPage: 1,
          items: [
            {
              createdAt: '2025-01-01T00:00:00Z',
              id: 1,
              targetId: 100,
              targetType: 'agent',
            },
          ],
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getMyFavorites();

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.myFavorites,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should get my favorites with pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoriteItem> = {
          currentPage: 2,
          items: [],
          pageSize: 10,
          totalCount: 25,
          totalPages: 3,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getMyFavorites({ page: 2, pageSize: 10 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.myFavorites}?page=2&pageSize=10`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });
    });

    describe('getUserFavoriteAgents', () => {
      it('should get user favorite agents without pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoriteAgentItem> = {
          currentPage: 1,
          items: [
            {
              avatar: 'https://example.com/avatar.png',
              category: 'assistant',
              createdAt: '2025-01-01T00:00:00Z',
              description: 'A helpful agent',
              identifier: 'my-agent',
              installCount: 100,
              name: 'My Agent',
              tags: ['helpful', 'ai'],
            },
          ],
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserFavoriteAgents(999);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.favoriteAgents(999),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should get user favorite agents with pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoriteAgentItem> = {
          currentPage: 3,
          items: [],
          pageSize: 5,
          totalCount: 15,
          totalPages: 3,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserFavoriteAgents(111, { page: 3, pageSize: 5 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.favoriteAgents(111)}?page=3&pageSize=5`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });
    });

    describe('getUserFavoritePlugins', () => {
      it('should get user favorite plugins without pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoritePluginItem> = {
          currentPage: 1,
          items: [
            {
              avatar: 'https://example.com/plugin-avatar.png',
              category: 'tool',
              createdAt: '2025-01-02T00:00:00Z',
              description: 'A useful plugin',
              identifier: 'my-plugin',
              name: 'My Plugin',
              tags: ['tool', 'utility'],
            },
          ],
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserFavoritePlugins(222);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.favoritePlugins(222),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should get user favorite plugins with pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoritePluginItem> = {
          currentPage: 2,
          items: [],
          pageSize: 8,
          totalCount: 16,
          totalPages: 2,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserFavoritePlugins(333, { page: 2, pageSize: 8 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.favoritePlugins(333)}?page=2&pageSize=8`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });
    });
  });

  describe('Like operations', () => {
    beforeEach(() => {
      socialService.setAccessToken(mockAccessToken);
    });

    describe('like', () => {
      it('should like an agent with numeric targetId', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'agent';
        await socialService.like(targetType, 123);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.like,
          expect.objectContaining({
            body: JSON.stringify({ targetId: 123, targetType: 'agent' }),
            method: 'POST',
          }),
        );
      });

      it('should like a plugin with string identifier', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'plugin';
        await socialService.like(targetType, 'awesome-plugin');

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.like,
          expect.objectContaining({
            body: JSON.stringify({ identifier: 'awesome-plugin', targetType: 'plugin' }),
            method: 'POST',
          }),
        );
      });
    });

    describe('unlike', () => {
      it('should unlike an agent with numeric targetId', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'agent';
        await socialService.unlike(targetType, 456);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.unlike,
          expect.objectContaining({
            body: JSON.stringify({ targetId: 456, targetType: 'agent' }),
            method: 'POST',
          }),
        );
      });

      it('should unlike a plugin with string identifier', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        const targetType: SocialTargetType = 'plugin';
        await socialService.unlike(targetType, 'cool-plugin');

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.unlike,
          expect.objectContaining({
            body: JSON.stringify({ identifier: 'cool-plugin', targetType: 'plugin' }),
            method: 'POST',
          }),
        );
      });
    });

    describe('checkLikeStatus', () => {
      it('should check like status with numeric targetId', async () => {
        const mockStatus: LikeStatus = { isLiked: true };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockStatus,
          ok: true,
          status: 200,
        } as Response);

        const targetType: SocialTargetType = 'agent';
        const result = await socialService.checkLikeStatus(targetType, 789);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.likeStatus(targetType, 789),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockStatus);
      });

      it('should check like status with string identifier', async () => {
        const mockStatus: LikeStatus = { isLiked: false };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockStatus,
          ok: true,
          status: 200,
        } as Response);

        const targetType: SocialTargetType = 'plugin';
        const result = await socialService.checkLikeStatus(targetType, 'test-plugin');

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.likeStatus(targetType, 'test-plugin'),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockStatus);
      });
    });

    describe('toggleLike', () => {
      it('should toggle like with numeric targetId and return liked=true', async () => {
        const mockResult: ToggleLikeResult = { liked: true };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResult,
          ok: true,
          status: 200,
        } as Response);

        const targetType: SocialTargetType = 'agent';
        const result = await socialService.toggleLike(targetType, 999);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.toggleLike,
          expect.objectContaining({
            body: JSON.stringify({ targetId: 999, targetType: 'agent' }),
            method: 'POST',
          }),
        );
        expect(result).toEqual(mockResult);
        expect(result.liked).toBe(true);
      });

      it('should toggle like with string identifier and return liked=false', async () => {
        const mockResult: ToggleLikeResult = { liked: false };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResult,
          ok: true,
          status: 200,
        } as Response);

        const targetType: SocialTargetType = 'plugin';
        const result = await socialService.toggleLike(targetType, 'toggle-plugin');

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.toggleLike,
          expect.objectContaining({
            body: JSON.stringify({ identifier: 'toggle-plugin', targetType: 'plugin' }),
            method: 'POST',
          }),
        );
        expect(result).toEqual(mockResult);
        expect(result.liked).toBe(false);
      });
    });

    describe('getUserLikedAgents', () => {
      it('should get user liked agents without pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoriteAgentItem> = {
          currentPage: 1,
          items: [
            {
              avatar: 'https://example.com/liked-agent.png',
              category: 'creative',
              createdAt: '2025-01-03T00:00:00Z',
              description: 'A creative agent',
              identifier: 'creative-agent',
              installCount: 200,
              name: 'Creative Agent',
              tags: ['creative', 'art'],
            },
          ],
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserLikedAgents(444);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.likedAgents(444),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should get user liked agents with pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoriteAgentItem> = {
          currentPage: 2,
          items: [],
          pageSize: 12,
          totalCount: 24,
          totalPages: 2,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserLikedAgents(555, { page: 2, pageSize: 12 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.likedAgents(555)}?page=2&pageSize=12`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });
    });

    describe('getUserLikedPlugins', () => {
      it('should get user liked plugins without pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoritePluginItem> = {
          currentPage: 1,
          items: [
            {
              avatar: 'https://example.com/liked-plugin.png',
              category: 'productivity',
              createdAt: '2025-01-04T00:00:00Z',
              description: 'A productivity plugin',
              identifier: 'productivity-plugin',
              name: 'Productivity Plugin',
              tags: ['productivity', 'work'],
            },
          ],
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserLikedPlugins(666);

        expect(global.fetch).toHaveBeenCalledWith(
          MARKET_ENDPOINTS.likedPlugins(666),
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });

      it('should get user liked plugins with pagination params', async () => {
        const mockResponse: PaginatedResponse<FavoritePluginItem> = {
          currentPage: 4,
          items: [],
          pageSize: 6,
          totalCount: 24,
          totalPages: 4,
        };

        vi.mocked(global.fetch).mockResolvedValueOnce({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        } as Response);

        const result = await socialService.getUserLikedPlugins(777, { page: 4, pageSize: 6 });

        expect(global.fetch).toHaveBeenCalledWith(
          `${MARKET_ENDPOINTS.likedPlugins(777)}?page=4&pageSize=6`,
          expect.objectContaining({
            method: 'GET',
          }),
        );
        expect(result).toEqual(mockResponse);
      });
    });
  });
});

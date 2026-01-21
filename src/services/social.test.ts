import { describe, expect, it, vi } from 'vitest';
import { testService } from '~test-utils';

import { SocialService, socialService } from './social';

const mockLambdaClient = vi.hoisted(() => ({
  market: {
    social: {
      // Follow mutations and queries
      follow: { mutate: vi.fn() },
      unfollow: { mutate: vi.fn() },
      checkFollowStatus: { query: vi.fn() },
      getFollowCounts: { query: vi.fn() },
      getFollowing: { query: vi.fn() },
      getFollowers: { query: vi.fn() },
      // Favorite mutations and queries
      addFavorite: { mutate: vi.fn() },
      removeFavorite: { mutate: vi.fn() },
      checkFavorite: { query: vi.fn() },
      getMyFavorites: { query: vi.fn() },
      getUserFavoriteAgents: { query: vi.fn() },
      getUserFavoritePlugins: { query: vi.fn() },
      // Like mutations and queries
      like: { mutate: vi.fn() },
      unlike: { mutate: vi.fn() },
      checkLike: { query: vi.fn() },
      toggleLike: { mutate: vi.fn() },
      getUserLikedAgents: { query: vi.fn() },
      getUserLikedPlugins: { query: vi.fn() },
    },
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: mockLambdaClient,
}));

describe('SocialService', () => {
  testService(SocialService, {
    checkAsync: false,
    skipMethods: ['setAccessToken'],
  });

  describe('Follow Operations', () => {
    describe('follow', () => {
      it('should call lambdaClient.market.social.follow.mutate with followingId', async () => {
        mockLambdaClient.market.social.follow.mutate.mockResolvedValueOnce(undefined);

        await socialService.follow(123);

        expect(mockLambdaClient.market.social.follow.mutate).toHaveBeenCalledWith({
          followingId: 123,
        });
      });
    });

    describe('unfollow', () => {
      it('should call lambdaClient.market.social.unfollow.mutate with followingId', async () => {
        mockLambdaClient.market.social.unfollow.mutate.mockResolvedValueOnce(undefined);

        await socialService.unfollow(456);

        expect(mockLambdaClient.market.social.unfollow.mutate).toHaveBeenCalledWith({
          followingId: 456,
        });
      });
    });

    describe('checkFollowStatus', () => {
      it('should call lambdaClient.market.social.checkFollowStatus.query with userId', async () => {
        const mockStatus = { isFollowing: true, isMutual: false };
        mockLambdaClient.market.social.checkFollowStatus.query.mockResolvedValueOnce(mockStatus);

        const result = await socialService.checkFollowStatus(789);

        expect(mockLambdaClient.market.social.checkFollowStatus.query).toHaveBeenCalledWith({
          targetUserId: 789,
        });
        expect(result).toEqual(mockStatus);
      });

      it('should return mutual follow status', async () => {
        const mockStatus = { isFollowing: true, isMutual: true };
        mockLambdaClient.market.social.checkFollowStatus.query.mockResolvedValueOnce(mockStatus);

        const result = await socialService.checkFollowStatus(100);

        expect(result.isMutual).toBe(true);
      });
    });

    describe('getFollowCounts', () => {
      it('should call lambdaClient.market.social.getFollowCounts.query with userId', async () => {
        const mockCounts = { followersCount: 50, followingCount: 30 };
        mockLambdaClient.market.social.getFollowCounts.query.mockResolvedValueOnce(mockCounts);

        const result = await socialService.getFollowCounts(999);

        expect(mockLambdaClient.market.social.getFollowCounts.query).toHaveBeenCalledWith({
          userId: 999,
        });
        expect(result).toEqual(mockCounts);
      });
    });

    describe('getFollowing', () => {
      it('should call lambdaClient.market.social.getFollowing.query without pagination params', async () => {
        const mockResponse = {
          currentPage: 1,
          items: [],
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        };
        mockLambdaClient.market.social.getFollowing.query.mockResolvedValueOnce(mockResponse);

        const result = await socialService.getFollowing(111);

        expect(mockLambdaClient.market.social.getFollowing.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 111,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate offset correctly with pagination params', async () => {
        const mockResponse = {
          currentPage: 2,
          items: [],
          pageSize: 20,
          totalCount: 50,
          totalPages: 3,
        };
        mockLambdaClient.market.social.getFollowing.query.mockResolvedValueOnce(mockResponse);

        await socialService.getFollowing(222, { page: 2, pageSize: 20 });

        expect(mockLambdaClient.market.social.getFollowing.query).toHaveBeenCalledWith({
          limit: 20,
          offset: 20,
          userId: 222,
        });
      });

      it('should use default pageSize of 10 for offset calculation when only page is provided', async () => {
        const mockResponse = {
          currentPage: 3,
          items: [],
          pageSize: 10,
          totalCount: 100,
          totalPages: 10,
        };
        mockLambdaClient.market.social.getFollowing.query.mockResolvedValueOnce(mockResponse);

        await socialService.getFollowing(333, { page: 3 });

        expect(mockLambdaClient.market.social.getFollowing.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: 20,
          userId: 333,
        });
      });
    });

    describe('getFollowers', () => {
      it('should call lambdaClient.market.social.getFollowers.query without pagination params', async () => {
        const mockResponse = {
          currentPage: 1,
          items: [],
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        };
        mockLambdaClient.market.social.getFollowers.query.mockResolvedValueOnce(mockResponse);

        const result = await socialService.getFollowers(444);

        expect(mockLambdaClient.market.social.getFollowers.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 444,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate offset correctly with pagination params', async () => {
        const mockResponse = {
          currentPage: 5,
          items: [],
          pageSize: 15,
          totalCount: 75,
          totalPages: 5,
        };
        mockLambdaClient.market.social.getFollowers.query.mockResolvedValueOnce(mockResponse);

        await socialService.getFollowers(555, { page: 5, pageSize: 15 });

        expect(mockLambdaClient.market.social.getFollowers.query).toHaveBeenCalledWith({
          limit: 15,
          offset: 60,
          userId: 555,
        });
      });
    });
  });

  describe('Favorite Operations', () => {
    describe('addFavorite', () => {
      it('should call lambdaClient.market.social.addFavorite.mutate with numeric targetId', async () => {
        mockLambdaClient.market.social.addFavorite.mutate.mockResolvedValueOnce(undefined);

        await socialService.addFavorite('agent', 123);

        expect(mockLambdaClient.market.social.addFavorite.mutate).toHaveBeenCalledWith({
          targetId: 123,
          targetType: 'agent',
        });
      });

      it('should call lambdaClient.market.social.addFavorite.mutate with string identifier', async () => {
        mockLambdaClient.market.social.addFavorite.mutate.mockResolvedValueOnce(undefined);

        await socialService.addFavorite('plugin', 'my-plugin-identifier');

        expect(mockLambdaClient.market.social.addFavorite.mutate).toHaveBeenCalledWith({
          identifier: 'my-plugin-identifier',
          targetType: 'plugin',
        });
      });
    });

    describe('removeFavorite', () => {
      it('should call lambdaClient.market.social.removeFavorite.mutate with numeric targetId', async () => {
        mockLambdaClient.market.social.removeFavorite.mutate.mockResolvedValueOnce(undefined);

        await socialService.removeFavorite('agent', 456);

        expect(mockLambdaClient.market.social.removeFavorite.mutate).toHaveBeenCalledWith({
          targetId: 456,
          targetType: 'agent',
        });
      });

      it('should call lambdaClient.market.social.removeFavorite.mutate with string identifier', async () => {
        mockLambdaClient.market.social.removeFavorite.mutate.mockResolvedValueOnce(undefined);

        await socialService.removeFavorite('plugin', 'another-plugin');

        expect(mockLambdaClient.market.social.removeFavorite.mutate).toHaveBeenCalledWith({
          identifier: 'another-plugin',
          targetType: 'plugin',
        });
      });
    });

    describe('checkFavoriteStatus', () => {
      it('should call lambdaClient.market.social.checkFavorite.query with numeric targetId', async () => {
        const mockStatus = { isFavorited: true };
        mockLambdaClient.market.social.checkFavorite.query.mockResolvedValueOnce(mockStatus);

        const result = await socialService.checkFavoriteStatus('agent', 789);

        expect(mockLambdaClient.market.social.checkFavorite.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 789,
          targetType: 'agent',
        });
        expect(result).toEqual(mockStatus);
      });

      it('should call lambdaClient.market.social.checkFavorite.query with string identifier', async () => {
        const mockStatus = { isFavorited: false };
        mockLambdaClient.market.social.checkFavorite.query.mockResolvedValueOnce(mockStatus);

        const result = await socialService.checkFavoriteStatus('plugin', 'test-identifier');

        expect(mockLambdaClient.market.social.checkFavorite.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 'test-identifier',
          targetType: 'plugin',
        });
        expect(result.isFavorited).toBe(false);
      });
    });

    describe('getMyFavorites', () => {
      it('should call lambdaClient.market.social.getMyFavorites.query without pagination params', async () => {
        const mockResponse = {
          currentPage: 1,
          items: [],
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        };
        mockLambdaClient.market.social.getMyFavorites.query.mockResolvedValueOnce(mockResponse);

        const result = await socialService.getMyFavorites();

        expect(mockLambdaClient.market.social.getMyFavorites.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate offset correctly with pagination params', async () => {
        const mockResponse = {
          currentPage: 2,
          items: [],
          pageSize: 25,
          totalCount: 50,
          totalPages: 2,
        };
        mockLambdaClient.market.social.getMyFavorites.query.mockResolvedValueOnce(mockResponse);

        await socialService.getMyFavorites({ page: 2, pageSize: 25 });

        expect(mockLambdaClient.market.social.getMyFavorites.query).toHaveBeenCalledWith({
          limit: 25,
          offset: 25,
        });
      });
    });

    describe('getUserFavoriteAgents', () => {
      it('should call lambdaClient.market.social.getUserFavoriteAgents.query without pagination params', async () => {
        const mockResponse = {
          currentPage: 1,
          items: [],
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        };
        mockLambdaClient.market.social.getUserFavoriteAgents.query.mockResolvedValueOnce(
          mockResponse,
        );

        const result = await socialService.getUserFavoriteAgents(111);

        expect(mockLambdaClient.market.social.getUserFavoriteAgents.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 111,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate offset correctly with pagination params', async () => {
        const mockResponse = {
          currentPage: 3,
          items: [],
          pageSize: 10,
          totalCount: 30,
          totalPages: 3,
        };
        mockLambdaClient.market.social.getUserFavoriteAgents.query.mockResolvedValueOnce(
          mockResponse,
        );

        await socialService.getUserFavoriteAgents(222, { page: 3, pageSize: 10 });

        expect(mockLambdaClient.market.social.getUserFavoriteAgents.query).toHaveBeenCalledWith({
          limit: 10,
          offset: 20,
          userId: 222,
        });
      });
    });

    describe('getUserFavoritePlugins', () => {
      it('should call lambdaClient.market.social.getUserFavoritePlugins.query without pagination params', async () => {
        const mockResponse = {
          currentPage: 1,
          items: [],
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        };
        mockLambdaClient.market.social.getUserFavoritePlugins.query.mockResolvedValueOnce(
          mockResponse,
        );

        const result = await socialService.getUserFavoritePlugins(333);

        expect(mockLambdaClient.market.social.getUserFavoritePlugins.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 333,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate offset correctly with pagination params', async () => {
        const mockResponse = {
          currentPage: 4,
          items: [],
          pageSize: 5,
          totalCount: 20,
          totalPages: 4,
        };
        mockLambdaClient.market.social.getUserFavoritePlugins.query.mockResolvedValueOnce(
          mockResponse,
        );

        await socialService.getUserFavoritePlugins(444, { page: 4, pageSize: 5 });

        expect(mockLambdaClient.market.social.getUserFavoritePlugins.query).toHaveBeenCalledWith({
          limit: 5,
          offset: 15,
          userId: 444,
        });
      });
    });
  });

  describe('Like Operations', () => {
    describe('like', () => {
      it('should call lambdaClient.market.social.like.mutate with numeric targetId', async () => {
        mockLambdaClient.market.social.like.mutate.mockResolvedValueOnce(undefined);

        await socialService.like('agent', 123);

        expect(mockLambdaClient.market.social.like.mutate).toHaveBeenCalledWith({
          targetId: 123,
          targetType: 'agent',
        });
      });

      it('should call lambdaClient.market.social.like.mutate with string identifier', async () => {
        mockLambdaClient.market.social.like.mutate.mockResolvedValueOnce(undefined);

        await socialService.like('plugin', 'plugin-identifier');

        expect(mockLambdaClient.market.social.like.mutate).toHaveBeenCalledWith({
          identifier: 'plugin-identifier',
          targetType: 'plugin',
        });
      });
    });

    describe('unlike', () => {
      it('should call lambdaClient.market.social.unlike.mutate with numeric targetId', async () => {
        mockLambdaClient.market.social.unlike.mutate.mockResolvedValueOnce(undefined);

        await socialService.unlike('agent', 456);

        expect(mockLambdaClient.market.social.unlike.mutate).toHaveBeenCalledWith({
          targetId: 456,
          targetType: 'agent',
        });
      });

      it('should call lambdaClient.market.social.unlike.mutate with string identifier', async () => {
        mockLambdaClient.market.social.unlike.mutate.mockResolvedValueOnce(undefined);

        await socialService.unlike('plugin', 'some-plugin');

        expect(mockLambdaClient.market.social.unlike.mutate).toHaveBeenCalledWith({
          identifier: 'some-plugin',
          targetType: 'plugin',
        });
      });
    });

    describe('checkLikeStatus', () => {
      it('should call lambdaClient.market.social.checkLike.query with numeric targetId', async () => {
        const mockStatus = { isLiked: true };
        mockLambdaClient.market.social.checkLike.query.mockResolvedValueOnce(mockStatus);

        const result = await socialService.checkLikeStatus('agent', 789);

        expect(mockLambdaClient.market.social.checkLike.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 789,
          targetType: 'agent',
        });
        expect(result).toEqual(mockStatus);
      });

      it('should call lambdaClient.market.social.checkLike.query with string identifier', async () => {
        const mockStatus = { isLiked: false };
        mockLambdaClient.market.social.checkLike.query.mockResolvedValueOnce(mockStatus);

        const result = await socialService.checkLikeStatus('plugin', 'test-plugin');

        expect(mockLambdaClient.market.social.checkLike.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 'test-plugin',
          targetType: 'plugin',
        });
        expect(result.isLiked).toBe(false);
      });
    });

    describe('toggleLike', () => {
      it('should call lambdaClient.market.social.toggleLike.mutate with numeric targetId', async () => {
        const mockResult = { liked: true };
        mockLambdaClient.market.social.toggleLike.mutate.mockResolvedValueOnce(mockResult);

        const result = await socialService.toggleLike('agent', 100);

        expect(mockLambdaClient.market.social.toggleLike.mutate).toHaveBeenCalledWith({
          targetId: 100,
          targetType: 'agent',
        });
        expect(result).toEqual(mockResult);
      });

      it('should call lambdaClient.market.social.toggleLike.mutate with string identifier', async () => {
        const mockResult = { liked: false };
        mockLambdaClient.market.social.toggleLike.mutate.mockResolvedValueOnce(mockResult);

        const result = await socialService.toggleLike('plugin', 'toggle-plugin');

        expect(mockLambdaClient.market.social.toggleLike.mutate).toHaveBeenCalledWith({
          identifier: 'toggle-plugin',
          targetType: 'plugin',
        });
        expect(result.liked).toBe(false);
      });
    });

    describe('getUserLikedAgents', () => {
      it('should call lambdaClient.market.social.getUserLikedAgents.query without pagination params', async () => {
        const mockResponse = {
          currentPage: 1,
          items: [],
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        };
        mockLambdaClient.market.social.getUserLikedAgents.query.mockResolvedValueOnce(mockResponse);

        const result = await socialService.getUserLikedAgents(555);

        expect(mockLambdaClient.market.social.getUserLikedAgents.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 555,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate offset correctly with pagination params', async () => {
        const mockResponse = {
          currentPage: 2,
          items: [],
          pageSize: 12,
          totalCount: 24,
          totalPages: 2,
        };
        mockLambdaClient.market.social.getUserLikedAgents.query.mockResolvedValueOnce(mockResponse);

        await socialService.getUserLikedAgents(666, { page: 2, pageSize: 12 });

        expect(mockLambdaClient.market.social.getUserLikedAgents.query).toHaveBeenCalledWith({
          limit: 12,
          offset: 12,
          userId: 666,
        });
      });
    });

    describe('getUserLikedPlugins', () => {
      it('should call lambdaClient.market.social.getUserLikedPlugins.query without pagination params', async () => {
        const mockResponse = {
          currentPage: 1,
          items: [],
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        };
        mockLambdaClient.market.social.getUserLikedPlugins.query.mockResolvedValueOnce(
          mockResponse,
        );

        const result = await socialService.getUserLikedPlugins(777);

        expect(mockLambdaClient.market.social.getUserLikedPlugins.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 777,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate offset correctly with pagination params', async () => {
        const mockResponse = {
          currentPage: 6,
          items: [],
          pageSize: 8,
          totalCount: 48,
          totalPages: 6,
        };
        mockLambdaClient.market.social.getUserLikedPlugins.query.mockResolvedValueOnce(
          mockResponse,
        );

        await socialService.getUserLikedPlugins(888, { page: 6, pageSize: 8 });

        expect(mockLambdaClient.market.social.getUserLikedPlugins.query).toHaveBeenCalledWith({
          limit: 8,
          offset: 40,
          userId: 888,
        });
      });
    });
  });

  describe('Deprecated Methods', () => {
    describe('setAccessToken', () => {
      it('should be a no-op function', () => {
        expect(() => {
          socialService.setAccessToken('some-token');
        }).not.toThrow();

        expect(() => {
          socialService.setAccessToken(undefined);
        }).not.toThrow();
      });
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { socialService } from '../social';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      social: {
        addFavorite: {
          mutate: vi.fn(),
        },
        checkFavorite: {
          query: vi.fn(),
        },
        checkFollowStatus: {
          query: vi.fn(),
        },
        checkLike: {
          query: vi.fn(),
        },
        follow: {
          mutate: vi.fn(),
        },
        getFollowCounts: {
          query: vi.fn(),
        },
        getFollowers: {
          query: vi.fn(),
        },
        getFollowing: {
          query: vi.fn(),
        },
        getMyFavorites: {
          query: vi.fn(),
        },
        getUserFavoriteAgents: {
          query: vi.fn(),
        },
        getUserFavoritePlugins: {
          query: vi.fn(),
        },
        getUserLikedAgents: {
          query: vi.fn(),
        },
        getUserLikedPlugins: {
          query: vi.fn(),
        },
        like: {
          mutate: vi.fn(),
        },
        removeFavorite: {
          mutate: vi.fn(),
        },
        toggleLike: {
          mutate: vi.fn(),
        },
        unfollow: {
          mutate: vi.fn(),
        },
        unlike: {
          mutate: vi.fn(),
        },
      },
    },
  },
}));

describe('SocialService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Follow Operations', () => {
    describe('follow', () => {
      it('should call lambdaClient to follow a user', async () => {
        await socialService.follow(123);

        expect(lambdaClient.market.social.follow.mutate).toHaveBeenCalledWith({
          followingId: 123,
        });
      });
    });

    describe('unfollow', () => {
      it('should call lambdaClient to unfollow a user', async () => {
        await socialService.unfollow(456);

        expect(lambdaClient.market.social.unfollow.mutate).toHaveBeenCalledWith({
          followingId: 456,
        });
      });
    });

    describe('checkFollowStatus', () => {
      it('should return follow status for a user', async () => {
        const mockStatus = { isFollowing: true, isMutual: false };
        vi.mocked(lambdaClient.market.social.checkFollowStatus.query).mockResolvedValue(mockStatus);

        const result = await socialService.checkFollowStatus(789);

        expect(lambdaClient.market.social.checkFollowStatus.query).toHaveBeenCalledWith({
          targetUserId: 789,
        });
        expect(result).toEqual(mockStatus);
      });
    });

    describe('getFollowCounts', () => {
      it('should return follow counts for a user', async () => {
        const mockCounts = { followersCount: 10, followingCount: 5 };
        vi.mocked(lambdaClient.market.social.getFollowCounts.query).mockResolvedValue(mockCounts);

        const result = await socialService.getFollowCounts(100);

        expect(lambdaClient.market.social.getFollowCounts.query).toHaveBeenCalledWith({
          userId: 100,
        });
        expect(result).toEqual(mockCounts);
      });
    });

    describe('getFollowing', () => {
      it('should return following list without pagination', async () => {
        const mockResponse = {
          currentPage: 1,
          data: [
            {
              avatarUrl: 'https://example.com/avatar.png',
              displayName: 'John Doe',
              id: 1,
              namespace: 'johndoe',
              userName: 'john',
            },
          ],
          items: [
            {
              avatarUrl: 'https://example.com/avatar.png',
              displayName: 'John Doe',
              id: 1,
              namespace: 'johndoe',
              userName: 'john',
            },
          ],
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        };
        vi.mocked(lambdaClient.market.social.getFollowing.query).mockResolvedValue(
          mockResponse as any,
        );

        const result = await socialService.getFollowing(100);

        expect(lambdaClient.market.social.getFollowing.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 100,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate correct offset for pagination', async () => {
        const mockResponse = {
          currentPage: 2,
          data: [],
          items: [],
          pageSize: 20,
          totalCount: 50,
          totalPages: 3,
        };
        vi.mocked(lambdaClient.market.social.getFollowing.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getFollowing(100, { page: 2, pageSize: 20 });

        expect(lambdaClient.market.social.getFollowing.query).toHaveBeenCalledWith({
          limit: 20,
          offset: 20, // (page - 1) * pageSize = (2 - 1) * 20
          userId: 100,
        });
      });

      it('should use default pageSize of 10 when only page is provided', async () => {
        const mockResponse = {
          currentPage: 3,
          data: [],
          items: [],
          pageSize: 10,
          totalCount: 30,
          totalPages: 3,
        };
        vi.mocked(lambdaClient.market.social.getFollowing.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getFollowing(100, { page: 3 });

        expect(lambdaClient.market.social.getFollowing.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: 20, // (page - 1) * 10
          userId: 100,
        });
      });
    });

    describe('getFollowers', () => {
      it('should return followers list without pagination', async () => {
        const mockResponse = {
          currentPage: 1,
          data: [
            {
              avatarUrl: 'https://example.com/avatar2.png',
              displayName: 'Jane Smith',
              id: 2,
              namespace: 'janesmith',
              userName: 'jane',
            },
          ],
          items: [
            {
              avatarUrl: 'https://example.com/avatar2.png',
              displayName: 'Jane Smith',
              id: 2,
              namespace: 'janesmith',
              userName: 'jane',
            },
          ],
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        };
        vi.mocked(lambdaClient.market.social.getFollowers.query).mockResolvedValue(
          mockResponse as any,
        );

        const result = await socialService.getFollowers(200);

        expect(lambdaClient.market.social.getFollowers.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 200,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate correct offset for pagination', async () => {
        const mockResponse = {
          currentPage: 2,
          data: [],
          items: [],
          pageSize: 15,
          totalCount: 45,
          totalPages: 3,
        };
        vi.mocked(lambdaClient.market.social.getFollowers.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getFollowers(200, { page: 2, pageSize: 15 });

        expect(lambdaClient.market.social.getFollowers.query).toHaveBeenCalledWith({
          limit: 15,
          offset: 15, // (page - 1) * pageSize = (2 - 1) * 15
          userId: 200,
        });
      });
    });
  });

  describe('Favorite Operations', () => {
    describe('addFavorite', () => {
      it('should add favorite with numeric target ID', async () => {
        await socialService.addFavorite('agent', 123);

        expect(lambdaClient.market.social.addFavorite.mutate).toHaveBeenCalledWith({
          targetId: 123,
          targetType: 'agent',
        });
      });

      it('should add favorite with string identifier', async () => {
        await socialService.addFavorite('plugin', 'my-plugin-identifier');

        expect(lambdaClient.market.social.addFavorite.mutate).toHaveBeenCalledWith({
          identifier: 'my-plugin-identifier',
          targetType: 'plugin',
        });
      });
    });

    describe('removeFavorite', () => {
      it('should remove favorite with numeric target ID', async () => {
        await socialService.removeFavorite('agent', 456);

        expect(lambdaClient.market.social.removeFavorite.mutate).toHaveBeenCalledWith({
          targetId: 456,
          targetType: 'agent',
        });
      });

      it('should remove favorite with string identifier', async () => {
        await socialService.removeFavorite('plugin', 'another-plugin');

        expect(lambdaClient.market.social.removeFavorite.mutate).toHaveBeenCalledWith({
          identifier: 'another-plugin',
          targetType: 'plugin',
        });
      });
    });

    describe('checkFavoriteStatus', () => {
      it('should return favorite status', async () => {
        const mockStatus = { isFavorited: true };
        vi.mocked(lambdaClient.market.social.checkFavorite.query).mockResolvedValue(mockStatus);

        const result = await socialService.checkFavoriteStatus('agent', 789);

        expect(lambdaClient.market.social.checkFavorite.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 789,
          targetType: 'agent',
        });
        expect(result).toEqual(mockStatus);
      });

      it('should work with string identifier', async () => {
        const mockStatus = { isFavorited: false };
        vi.mocked(lambdaClient.market.social.checkFavorite.query).mockResolvedValue(mockStatus);

        const result = await socialService.checkFavoriteStatus('plugin', 'test-plugin');

        expect(lambdaClient.market.social.checkFavorite.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 'test-plugin',
          targetType: 'plugin',
        });
        expect(result).toEqual(mockStatus);
      });
    });

    describe('getMyFavorites', () => {
      it('should return favorites list without pagination', async () => {
        const mockResponse = {
          currentPage: 1,
          data: [
            {
              createdAt: '2024-01-01T00:00:00Z',
              id: 1,
              targetId: 100,
              targetType: 'agent' as const,
            },
          ],
          items: [
            {
              createdAt: '2024-01-01T00:00:00Z',
              id: 1,
              targetId: 100,
              targetType: 'agent' as const,
            },
          ],
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        };
        vi.mocked(lambdaClient.market.social.getMyFavorites.query).mockResolvedValue(
          mockResponse as any,
        );

        const result = await socialService.getMyFavorites();

        expect(lambdaClient.market.social.getMyFavorites.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate correct offset for pagination', async () => {
        const mockResponse = {
          currentPage: 3,
          data: [],
          items: [],
          pageSize: 25,
          totalCount: 75,
          totalPages: 3,
        };
        vi.mocked(lambdaClient.market.social.getMyFavorites.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getMyFavorites({ page: 3, pageSize: 25 });

        expect(lambdaClient.market.social.getMyFavorites.query).toHaveBeenCalledWith({
          limit: 25,
          offset: 50, // (page - 1) * pageSize = (3 - 1) * 25
        });
      });
    });

    describe('getUserFavoriteAgents', () => {
      it('should return user favorite agents without pagination', async () => {
        const mockResponse = {
          currentPage: 1,
          data: [
            {
              avatar: 'https://example.com/agent.png',
              category: 'productivity',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'A helpful agent',
              identifier: 'agent-1',
              installCount: 100,
              name: 'Agent 1',
              tags: ['tag1', 'tag2'],
            },
          ],
          items: [
            {
              avatar: 'https://example.com/agent.png',
              category: 'productivity',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'A helpful agent',
              identifier: 'agent-1',
              installCount: 100,
              name: 'Agent 1',
              tags: ['tag1', 'tag2'],
            },
          ],
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        };
        vi.mocked(lambdaClient.market.social.getUserFavoriteAgents.query).mockResolvedValue(
          mockResponse as any,
        );

        const result = await socialService.getUserFavoriteAgents(300);

        expect(lambdaClient.market.social.getUserFavoriteAgents.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 300,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate correct offset for pagination', async () => {
        const mockResponse = {
          currentPage: 2,
          data: [],
          items: [],
          pageSize: 12,
          totalCount: 24,
          totalPages: 2,
        };
        vi.mocked(lambdaClient.market.social.getUserFavoriteAgents.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getUserFavoriteAgents(300, { page: 2, pageSize: 12 });

        expect(lambdaClient.market.social.getUserFavoriteAgents.query).toHaveBeenCalledWith({
          limit: 12,
          offset: 12, // (page - 1) * pageSize = (2 - 1) * 12
          userId: 300,
        });
      });
    });

    describe('getUserFavoritePlugins', () => {
      it('should return user favorite plugins without pagination', async () => {
        const mockResponse = {
          currentPage: 1,
          data: [
            {
              avatar: 'https://example.com/plugin.png',
              category: 'utility',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'A useful plugin',
              identifier: 'plugin-1',
              name: 'Plugin 1',
              tags: ['utility', 'helper'],
            },
          ],
          items: [
            {
              avatar: 'https://example.com/plugin.png',
              category: 'utility',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'A useful plugin',
              identifier: 'plugin-1',
              name: 'Plugin 1',
              tags: ['utility', 'helper'],
            },
          ],
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        };
        vi.mocked(lambdaClient.market.social.getUserFavoritePlugins.query).mockResolvedValue(
          mockResponse as any,
        );

        const result = await socialService.getUserFavoritePlugins(400);

        expect(lambdaClient.market.social.getUserFavoritePlugins.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 400,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate correct offset for pagination', async () => {
        const mockResponse = {
          currentPage: 4,
          data: [],
          items: [],
          pageSize: 8,
          totalCount: 32,
          totalPages: 4,
        };
        vi.mocked(lambdaClient.market.social.getUserFavoritePlugins.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getUserFavoritePlugins(400, { page: 4, pageSize: 8 });

        expect(lambdaClient.market.social.getUserFavoritePlugins.query).toHaveBeenCalledWith({
          limit: 8,
          offset: 24, // (page - 1) * pageSize = (4 - 1) * 8
          userId: 400,
        });
      });
    });
  });

  describe('Like Operations', () => {
    describe('like', () => {
      it('should like target with numeric ID', async () => {
        await socialService.like('agent', 111);

        expect(lambdaClient.market.social.like.mutate).toHaveBeenCalledWith({
          targetId: 111,
          targetType: 'agent',
        });
      });

      it('should like target with string identifier', async () => {
        await socialService.like('plugin', 'plugin-identifier');

        expect(lambdaClient.market.social.like.mutate).toHaveBeenCalledWith({
          identifier: 'plugin-identifier',
          targetType: 'plugin',
        });
      });
    });

    describe('unlike', () => {
      it('should unlike target with numeric ID', async () => {
        await socialService.unlike('agent', 222);

        expect(lambdaClient.market.social.unlike.mutate).toHaveBeenCalledWith({
          targetId: 222,
          targetType: 'agent',
        });
      });

      it('should unlike target with string identifier', async () => {
        await socialService.unlike('plugin', 'another-plugin-id');

        expect(lambdaClient.market.social.unlike.mutate).toHaveBeenCalledWith({
          identifier: 'another-plugin-id',
          targetType: 'plugin',
        });
      });
    });

    describe('checkLikeStatus', () => {
      it('should return like status for numeric ID', async () => {
        const mockStatus = { isLiked: true };
        vi.mocked(lambdaClient.market.social.checkLike.query).mockResolvedValue(mockStatus);

        const result = await socialService.checkLikeStatus('agent', 333);

        expect(lambdaClient.market.social.checkLike.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 333,
          targetType: 'agent',
        });
        expect(result).toEqual(mockStatus);
      });

      it('should return like status for string identifier', async () => {
        const mockStatus = { isLiked: false };
        vi.mocked(lambdaClient.market.social.checkLike.query).mockResolvedValue(mockStatus);

        const result = await socialService.checkLikeStatus('plugin', 'test-plugin-id');

        expect(lambdaClient.market.social.checkLike.query).toHaveBeenCalledWith({
          targetIdOrIdentifier: 'test-plugin-id',
          targetType: 'plugin',
        });
        expect(result).toEqual(mockStatus);
      });
    });

    describe('toggleLike', () => {
      it('should toggle like with numeric ID', async () => {
        const mockResult = { liked: true };
        vi.mocked(lambdaClient.market.social.toggleLike.mutate).mockResolvedValue(mockResult);

        const result = await socialService.toggleLike('agent', 444);

        expect(lambdaClient.market.social.toggleLike.mutate).toHaveBeenCalledWith({
          targetId: 444,
          targetType: 'agent',
        });
        expect(result).toEqual(mockResult);
      });

      it('should toggle like with string identifier', async () => {
        const mockResult = { liked: false };
        vi.mocked(lambdaClient.market.social.toggleLike.mutate).mockResolvedValue(mockResult);

        const result = await socialService.toggleLike('plugin', 'toggle-plugin');

        expect(lambdaClient.market.social.toggleLike.mutate).toHaveBeenCalledWith({
          identifier: 'toggle-plugin',
          targetType: 'plugin',
        });
        expect(result).toEqual(mockResult);
      });
    });

    describe('getUserLikedAgents', () => {
      it('should return user liked agents without pagination', async () => {
        const mockResponse = {
          currentPage: 1,
          data: [
            {
              avatar: 'https://example.com/liked-agent.png',
              category: 'entertainment',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'An entertaining agent',
              identifier: 'liked-agent-1',
              installCount: 500,
              name: 'Liked Agent 1',
              tags: ['fun', 'games'],
            },
          ],
          items: [
            {
              avatar: 'https://example.com/liked-agent.png',
              category: 'entertainment',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'An entertaining agent',
              identifier: 'liked-agent-1',
              installCount: 500,
              name: 'Liked Agent 1',
              tags: ['fun', 'games'],
            },
          ],
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        };
        vi.mocked(lambdaClient.market.social.getUserLikedAgents.query).mockResolvedValue(
          mockResponse as any,
        );

        const result = await socialService.getUserLikedAgents(500);

        expect(lambdaClient.market.social.getUserLikedAgents.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 500,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate correct offset for pagination', async () => {
        const mockResponse = {
          currentPage: 5,
          data: [],
          items: [],
          pageSize: 6,
          totalCount: 30,
          totalPages: 5,
        };
        vi.mocked(lambdaClient.market.social.getUserLikedAgents.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getUserLikedAgents(500, { page: 5, pageSize: 6 });

        expect(lambdaClient.market.social.getUserLikedAgents.query).toHaveBeenCalledWith({
          limit: 6,
          offset: 24, // (page - 1) * pageSize = (5 - 1) * 6
          userId: 500,
        });
      });
    });

    describe('getUserLikedPlugins', () => {
      it('should return user liked plugins without pagination', async () => {
        const mockResponse = {
          currentPage: 1,
          data: [
            {
              avatar: 'https://example.com/liked-plugin.png',
              category: 'tool',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'A helpful tool plugin',
              identifier: 'liked-plugin-1',
              name: 'Liked Plugin 1',
              tags: ['tool', 'productivity'],
            },
          ],
          items: [
            {
              avatar: 'https://example.com/liked-plugin.png',
              category: 'tool',
              createdAt: '2024-01-01T00:00:00Z',
              description: 'A helpful tool plugin',
              identifier: 'liked-plugin-1',
              name: 'Liked Plugin 1',
              tags: ['tool', 'productivity'],
            },
          ],
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        };
        vi.mocked(lambdaClient.market.social.getUserLikedPlugins.query).mockResolvedValue(
          mockResponse as any,
        );

        const result = await socialService.getUserLikedPlugins(600);

        expect(lambdaClient.market.social.getUserLikedPlugins.query).toHaveBeenCalledWith({
          limit: undefined,
          offset: undefined,
          userId: 600,
        });
        expect(result).toEqual(mockResponse);
      });

      it('should calculate correct offset for pagination', async () => {
        const mockResponse = {
          currentPage: 3,
          data: [],
          items: [],
          pageSize: 18,
          totalCount: 54,
          totalPages: 3,
        };
        vi.mocked(lambdaClient.market.social.getUserLikedPlugins.query).mockResolvedValue(
          mockResponse as any,
        );

        await socialService.getUserLikedPlugins(600, { page: 3, pageSize: 18 });

        expect(lambdaClient.market.social.getUserLikedPlugins.query).toHaveBeenCalledWith({
          limit: 18,
          offset: 36, // (page - 1) * pageSize = (3 - 1) * 18
          userId: 600,
        });
      });
    });
  });

  describe('Deprecated Methods', () => {
    describe('setAccessToken', () => {
      it('should be a no-op and not throw errors', () => {
        expect(() => socialService.setAccessToken('test-token')).not.toThrow();
        expect(() => socialService.setAccessToken(undefined)).not.toThrow();
      });
    });
  });
});

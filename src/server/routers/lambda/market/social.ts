import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { marketSDK, marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';

const log = debug('lambda-router:market:social');

// Authenticated procedure for social actions that require login
const socialAuthProcedure = authedProcedure.use(serverDatabase).use(marketUserInfo).use(marketSDK);

// Public procedure with optional auth for status checks
const socialPublicProcedure = publicProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(marketSDK);

// Schema definitions
const targetTypeSchema = z.enum(['agent', 'plugin', 'agent-group']);

const paginationSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export const socialRouter = router({
  // ============================== Favorite Actions ==============================
  /**
   * Add to favorites
   * POST /market/social/favorite
   */
  addFavorite: socialAuthProcedure
    .input(
      z.object({
        identifier: z.string().optional(),
        targetId: z.number().optional(),
        targetType: targetTypeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('addFavorite input: %O', input);

      try {
        const targetValue = input.identifier ?? input.targetId;
        if (!targetValue) {
          throw new Error('Either identifier or targetId is required');
        }
        await ctx.marketSDK.favorites.addFavorite(input.targetType, targetValue as any);
        return { success: true };
      } catch (error) {
        log('Error adding favorite: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to add favorite',
        });
      }
    }),

  /**
   * Check if item is favorited
   * GET /market/social/favorite-status/[targetType]/[targetId]
   */
  checkFavorite: socialPublicProcedure
    .input(
      z.object({
        targetIdOrIdentifier: z.union([z.number(), z.string()]),
        targetType: targetTypeSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      log('checkFavorite input: %O', input);

      if (!ctx.marketSDK) {
        return { isFavorited: false };
      }

      try {
        const result = await ctx.marketSDK.favorites.checkFavorite(
          input.targetType,
          input.targetIdOrIdentifier as any,
        );
        return result;
      } catch (error) {
        log('Error checking favorite: %O', error);
        return { isFavorited: false };
      }
    }),

  // ============================== Follow Actions ==============================
  /**
   * Check follow status between current user and target user
   * GET /market/social/follow-status/[userId]
   */
  checkFollowStatus: socialPublicProcedure
    .input(z.object({ targetUserId: z.number() }))
    .query(async ({ input, ctx }) => {
      log('checkFollowStatus input: %O', input);

      // If no auth, return default status
      if (!ctx.marketSDK) {
        return { isFollowing: false, isMutual: false };
      }

      try {
        const result = await ctx.marketSDK.follows.checkFollowStatus(input.targetUserId);
        return result;
      } catch (error) {
        log('Error checking follow status: %O', error);
        // Return default on error (user might not be authenticated)
        return { isFollowing: false, isMutual: false };
      }
    }),

  // ============================== Like Actions ==============================
  /**
   * Check if item is liked
   * GET /market/social/like-status/[targetType]/[targetId]
   */
  checkLike: socialPublicProcedure
    .input(
      z.object({
        targetIdOrIdentifier: z.union([z.number(), z.string()]),
        targetType: targetTypeSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      log('checkLike input: %O', input);

      if (!ctx.marketSDK) {
        return { isLiked: false };
      }

      try {
        const result = await ctx.marketSDK.likes.checkLike(
          input.targetType,
          input.targetIdOrIdentifier as any,
        );
        return result;
      } catch (error) {
        log('Error checking like: %O', error);
        return { isLiked: false };
      }
    }),

  /**
   * Follow a user
   * POST /market/social/follow
   */
  follow: socialAuthProcedure
    .input(z.object({ followingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      log('follow input: %O', input);

      try {
        await ctx.marketSDK.follows.follow(input.followingId);
        return { success: true };
      } catch (error) {
        log('Error following user: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to follow user',
        });
      }
    }),

  /**
   * Get follow counts for a user
   * GET /market/social/follow-counts/[userId]
   */
  getFollowCounts: socialPublicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input, ctx }) => {
      log('getFollowCounts input: %O', input);

      try {
        const [following, followers] = await Promise.all([
          ctx.marketSDK.follows.getFollowing(input.userId, { limit: 1 }),
          ctx.marketSDK.follows.getFollowers(input.userId, { limit: 1 }),
        ]);

        return {
          followersCount: (followers as any).totalCount || (followers as any).total || 0,
          followingCount: (following as any).totalCount || (following as any).total || 0,
        };
      } catch (error) {
        log('Error getting follow counts: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get follow counts',
        });
      }
    }),

  /**
   * Get followers of a user
   * GET /market/social/followers/[userId]
   */
  getFollowers: socialPublicProcedure
    .input(z.object({ userId: z.number() }).merge(paginationSchema))
    .query(async ({ input, ctx }) => {
      log('getFollowers input: %O', input);

      try {
        const { userId, ...params } = input;
        const result = await ctx.marketSDK.follows.getFollowers(userId, params);
        return result;
      } catch (error) {
        log('Error getting followers: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get followers',
        });
      }
    }),

  /**
   * Get users that a user is following
   * GET /market/social/following/[userId]
   */
  getFollowing: socialPublicProcedure
    .input(z.object({ userId: z.number() }).merge(paginationSchema))
    .query(async ({ input, ctx }) => {
      log('getFollowing input: %O', input);

      try {
        const { userId, ...params } = input;
        const result = await ctx.marketSDK.follows.getFollowing(userId, params);
        return result;
      } catch (error) {
        log('Error getting following: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get following',
        });
      }
    }),

  /**
   * Get current user's favorites
   * GET /market/social/favorites
   */
  getMyFavorites: socialAuthProcedure
    .input(paginationSchema.optional())
    .query(async ({ input, ctx }) => {
      log('getMyFavorites input: %O', input);

      try {
        const result = await ctx.marketSDK.favorites.getMyFavorites(input);
        return result;
      } catch (error) {
        log('Error getting my favorites: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get favorites',
        });
      }
    }),

  /**
   * Get user's favorite agents
   * GET /market/social/favorite-agents/[userId]
   */
  getUserFavoriteAgents: socialPublicProcedure
    .input(z.object({ userId: z.number() }).merge(paginationSchema))
    .query(async ({ input, ctx }) => {
      log('getUserFavoriteAgents input: %O', input);

      try {
        const { userId, ...params } = input;
        const result = await ctx.marketSDK.favorites.getUserFavoriteAgents(userId, params);
        return result;
      } catch (error) {
        log('Error getting user favorite agents: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get favorite agents',
        });
      }
    }),

  /**
   * Get user's favorite plugins
   * GET /market/social/favorite-plugins/[userId]
   */
  getUserFavoritePlugins: socialPublicProcedure
    .input(z.object({ userId: z.number() }).merge(paginationSchema))
    .query(async ({ input, ctx }) => {
      log('getUserFavoritePlugins input: %O', input);

      try {
        const { userId, ...params } = input;
        const result = await ctx.marketSDK.favorites.getUserFavoritePlugins(userId, params);
        return result;
      } catch (error) {
        log('Error getting user favorite plugins: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get favorite plugins',
        });
      }
    }),

  /**
   * Get user's all favorites
   * GET /market/social/user-favorites/[userId]
   */
  getUserFavorites: socialPublicProcedure
    .input(z.object({ userId: z.number() }).merge(paginationSchema))
    .query(async ({ input, ctx }) => {
      log('getUserFavorites input: %O', input);

      try {
        const { userId, ...params } = input;
        const result = await ctx.marketSDK.favorites.getUserFavorites(userId, params);
        return result;
      } catch (error) {
        log('Error getting user favorites: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get user favorites',
        });
      }
    }),

  /**
   * Get user's liked agents
   * GET /market/social/liked-agents/[userId]
   */
  getUserLikedAgents: socialPublicProcedure
    .input(z.object({ userId: z.number() }).merge(paginationSchema))
    .query(async ({ input, ctx }) => {
      log('getUserLikedAgents input: %O', input);

      try {
        const { userId, ...params } = input;
        const result = await ctx.marketSDK.likes.getUserLikedAgents(userId, params);
        return result;
      } catch (error) {
        log('Error getting user liked agents: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get liked agents',
        });
      }
    }),

  /**
   * Get user's liked plugins
   * GET /market/social/liked-plugins/[userId]
   */
  getUserLikedPlugins: socialPublicProcedure
    .input(z.object({ userId: z.number() }).merge(paginationSchema))
    .query(async ({ input, ctx }) => {
      log('getUserLikedPlugins input: %O', input);

      try {
        const { userId, ...params } = input;
        const result = await ctx.marketSDK.likes.getUserLikedPlugins(userId, params);
        return result;
      } catch (error) {
        log('Error getting user liked plugins: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get liked plugins',
        });
      }
    }),

  /**
   * Like an item
   * POST /market/social/like
   */
  like: socialAuthProcedure
    .input(
      z.object({
        identifier: z.string().optional(),
        targetId: z.number().optional(),
        targetType: targetTypeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('like input: %O', input);

      try {
        const targetValue = input.identifier ?? input.targetId;
        if (!targetValue) {
          throw new Error('Either identifier or targetId is required');
        }
        await ctx.marketSDK.likes.like(input.targetType, targetValue as any);
        return { success: true };
      } catch (error) {
        log('Error liking item: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to like item',
        });
      }
    }),

  /**
   * Remove from favorites
   * POST /market/social/unfavorite
   */
  removeFavorite: socialAuthProcedure
    .input(
      z.object({
        identifier: z.string().optional(),
        targetId: z.number().optional(),
        targetType: targetTypeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('removeFavorite input: %O', input);

      try {
        const targetValue = input.identifier ?? input.targetId;
        if (!targetValue) {
          throw new Error('Either identifier or targetId is required');
        }
        await ctx.marketSDK.favorites.removeFavorite(input.targetType, targetValue as any);
        return { success: true };
      } catch (error) {
        log('Error removing favorite: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to remove favorite',
        });
      }
    }),

  /**
   * Toggle like on an item
   * POST /market/social/toggle-like
   */
  toggleLike: socialAuthProcedure
    .input(
      z.object({
        identifier: z.string().optional(),
        targetId: z.number().optional(),
        targetType: targetTypeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('toggleLike input: %O', input);

      try {
        const targetValue = input.identifier ?? input.targetId;
        if (!targetValue) {
          throw new Error('Either identifier or targetId is required');
        }
        const result = await ctx.marketSDK.likes.toggleLike(input.targetType, targetValue as any);
        return result;
      } catch (error) {
        log('Error toggling like: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to toggle like',
        });
      }
    }),

  /**
   * Unfollow a user
   * POST /market/social/unfollow
   */
  unfollow: socialAuthProcedure
    .input(z.object({ followingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      log('unfollow input: %O', input);

      try {
        await ctx.marketSDK.follows.unfollow(input.followingId);
        return { success: true };
      } catch (error) {
        log('Error unfollowing user: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to unfollow user',
        });
      }
    }),

  /**
   * Unlike an item
   * POST /market/social/unlike
   */
  unlike: socialAuthProcedure
    .input(
      z.object({
        identifier: z.string().optional(),
        targetId: z.number().optional(),
        targetType: targetTypeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('unlike input: %O', input);

      try {
        const targetValue = input.identifier ?? input.targetId;
        if (!targetValue) {
          throw new Error('Either identifier or targetId is required');
        }
        await ctx.marketSDK.likes.unlike(input.targetType, targetValue as any);
        return { success: true };
      } catch (error) {
        log('Error unliking item: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to unlike item',
        });
      }
    }),
});

export type SocialRouter = typeof socialRouter;

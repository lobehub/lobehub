import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { marketSDK, marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';

const log = debug('lambda-router:market:user');

// Authenticated procedure for user profile updates
const userAuthProcedure = authedProcedure.use(serverDatabase).use(marketUserInfo).use(marketSDK);

// Public procedure for viewing user profiles
const userPublicProcedure = publicProcedure.use(serverDatabase).use(marketUserInfo).use(marketSDK);

// Schema definitions
const socialLinksSchema = z.object({
  github: z.string().optional(),
  twitter: z.string().optional(),
  website: z.string().optional(),
});

const userMetaSchema = z.object({
  bannerUrl: z.string().optional(),
  description: z.string().optional(),
  socialLinks: socialLinksSchema.optional(),
});

const updateUserProfileSchema = z.object({
  avatarUrl: z.string().optional(),
  displayName: z.string().optional(),
  meta: userMetaSchema.optional(),
  userName: z.string().optional(),
});

export const userRouter = router({
  /**
   * Get user profile by username
   * GET /market/user/[username]
   */
  getUserByUsername: userPublicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getUserByUsername input: %O', input);

      try {
        const response = await ctx.marketSDK.user.getUserInfo(input.username);

        if (!response?.user) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `User not found: ${input.username}`,
          });
        }

        const { user } = response;

        return {
          avatarUrl: user.avatarUrl || null,
          bannerUrl: user.meta?.bannerUrl || null,
          createdAt: user.createdAt,
          description: user.meta?.description || null,
          displayName: user.displayName || null,
          id: user.id,
          namespace: user.namespace,
          socialLinks: user.meta?.socialLinks || null,
          type: user.type || null,
          userName: user.userName || null,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        log('Error getting user profile: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get user profile',
        });
      }
    }),

  /**
   * Update current user's profile
   * PUT /market/user/me
   */
  updateUserProfile: userAuthProcedure
    .input(updateUserProfileSchema)
    .mutation(async ({ input, ctx }) => {
      log('updateUserProfile input: %O', input);

      try {
        // Ensure meta is at least an empty object
        const normalizedPayload = {
          ...input,
          meta: input.meta ?? {},
        };

        const response = await ctx.marketSDK.user.updateUserInfo(normalizedPayload);
        return response;
      } catch (error) {
        log('Error updating user profile: %O', error);

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isUserNameTaken = errorMessage.toLowerCase().includes('already taken');

        if (isUserNameTaken) {
          throw new TRPCError({
            cause: error,
            code: 'CONFLICT',
            message: 'Username is already taken',
          });
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: errorMessage,
        });
      }
    }),
});

export type UserRouter = typeof userRouter;

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';

const log = debug('lambda-router:market:oidc');

// OIDC procedures are public (used during authentication flow)
const oidcProcedure = publicProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    // Initialize MarketService (may be without auth for public endpoints)
    const marketService = new MarketService({
      userInfo: ctx.marketUserInfo,
    });

    return next({
      ctx: {
        marketService,
      },
    });
  });

export const oidcRouter = router({
  /**
   * Exchange OAuth code for tokens
   * POST /market/oidc/token (with grant_type=authorization_code)
   */
  exchangeAuthorizationCode: oidcProcedure
    .input(
      z.object({
        clientId: z.string(),
        code: z.string(),
        codeVerifier: z.string(),
        redirectUri: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('exchangeAuthorizationCode input: %O', { ...input, code: '[REDACTED]' });

      try {
        const response = await ctx.marketService.exchangeAuthorizationCode(input);
        return response;
      } catch (error) {
        log('Error exchanging authorization code: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to exchange authorization code',
        });
      }
    }),

  /**
   * Get OAuth handoff information
   * GET /market/oidc/handoff?id=xxx
   */
  getOAuthHandoff: oidcProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getOAuthHandoff input: %O', input);

      try {
        const handoff = await ctx.marketService.getOAuthHandoff(input.id);
        return handoff;
      } catch (error) {
        log('Error getting OAuth handoff: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get OAuth handoff',
        });
      }
    }),

  /**
   * Get user info from token or trusted client
   * POST /market/oidc/userinfo
   */
  getUserInfo: oidcProcedure
    .input(z.object({ token: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      log('getUserInfo input: token=%s', input.token ? '[REDACTED]' : 'undefined');

      try {
        // If token is provided, use it
        if (input.token) {
          const response = await ctx.marketService.getUserInfo(input.token);
          return response;
        }

        // Otherwise, try to use trustedClientToken
        if (ctx.marketUserInfo) {
          const response = await ctx.marketService.getUserInfoWithTrustedClient();
          return response;
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Token is required for userinfo',
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        log('Error getting user info: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get user info',
        });
      }
    }),

  /**
   * Refresh access token
   * POST /market/oidc/token (with grant_type=refresh_token)
   */
  refreshToken: oidcProcedure
    .input(
      z.object({
        clientId: z.string().optional(),
        refreshToken: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('refreshToken input: %O', { ...input, refreshToken: '[REDACTED]' });

      try {
        const response = await ctx.marketService.refreshToken({
          clientId: input.clientId || '',
          refreshToken: input.refreshToken,
        });
        return response;
      } catch (error) {
        log('Error refreshing token: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to refresh token',
        });
      }
    }),
});

export type OidcRouter = typeof oidcRouter;

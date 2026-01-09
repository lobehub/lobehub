import { MarketSDK } from '@lobehub/market-sdk';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { generateTrustedClientToken } from '@/libs/trusted-client';

const log = debug('lambda-router:market:oidc');

const MARKET_BASE_URL = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';

// OIDC procedures are public (used during authentication flow)
const oidcProcedure = publicProcedure.use(serverDatabase).use(marketUserInfo);

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
    .mutation(async ({ input }) => {
      log('exchangeAuthorizationCode input: %O', { ...input, code: '[REDACTED]' });

      const market = new MarketSDK({ baseURL: MARKET_BASE_URL });

      try {
        const response = await market.auth.exchangeOAuthToken({
          clientId: input.clientId,
          code: input.code,
          codeVerifier: input.codeVerifier,
          grantType: 'authorization_code',
          redirectUri: input.redirectUri,
        });
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
  getOAuthHandoff: oidcProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    log('getOAuthHandoff input: %O', input);

    const market = new MarketSDK({ baseURL: MARKET_BASE_URL });

    try {
      const handoff = await market.auth.getOAuthHandoff(input.id);
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

      const market = new MarketSDK({ baseURL: MARKET_BASE_URL });

      try {
        // If token is provided, use it
        if (input.token) {
          const response = await market.auth.getUserInfo(input.token);
          return response;
        }

        // Otherwise, try to use trustedClientToken
        if (ctx.marketUserInfo) {
          const trustedClientToken = generateTrustedClientToken(ctx.marketUserInfo);

          if (trustedClientToken) {
            const userInfoUrl = `${MARKET_BASE_URL}/lobehub-oidc/userinfo`;
            const response = await fetch(userInfoUrl, {
              headers: {
                'Content-Type': 'application/json',
                'x-lobe-trust-token': trustedClientToken,
              },
              method: 'GET',
            });

            if (!response.ok) {
              throw new Error(
                `Failed to fetch user info: ${response.status} ${response.statusText}`,
              );
            }

            return await response.json();
          }
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
    .mutation(async ({ input }) => {
      log('refreshToken input: %O', { ...input, refreshToken: '[REDACTED]' });

      const market = new MarketSDK({ baseURL: MARKET_BASE_URL });

      try {
        const response = await market.auth.exchangeOAuthToken({
          clientId: input.clientId,
          grantType: 'refresh_token',
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

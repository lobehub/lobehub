import { MarketSDK } from '@lobehub/market-sdk';

import { generateTrustedClientToken, type TrustedClientUserInfo } from '@/libs/trusted-client';

import { trpc } from '../init';

interface ContextWithMarketUserInfo {
  marketAccessToken?: string;
  marketUserInfo?: TrustedClientUserInfo;
}

/**
 * Middleware that initializes MarketSDK with proper authentication.
 * This requires marketUserInfo middleware to be applied first.
 *
 * Provides:
 * - ctx.marketSDK: Initialized MarketSDK instance with trustedClientToken and optional accessToken
 * - ctx.trustedClientToken: The generated trusted client token (if available)
 */
export const marketSDK = trpc.middleware(async (opts) => {
  const ctx = opts.ctx as ContextWithMarketUserInfo;

  // Generate trusted client token if user info is available
  const trustedClientToken = ctx.marketUserInfo
    ? generateTrustedClientToken(ctx.marketUserInfo)
    : undefined;

  // Initialize MarketSDK with both authentication methods
  const market = new MarketSDK({
    accessToken: ctx.marketAccessToken,
    baseURL: process.env.NEXT_PUBLIC_MARKET_BASE_URL,
    trustedClientToken,
  });

  return opts.next({
    ctx: {
      marketSDK: market,
      trustedClientToken,
    },
  });
});

/**
 * Middleware that requires authentication for Market API access.
 * This middleware ensures that either accessToken or trustedClientToken is available.
 * It should be used after marketUserInfo and marketSDK middlewares.
 *
 * Throws UNAUTHORIZED error if neither authentication method is available.
 */
export const requireMarketAuth = trpc.middleware(async (opts) => {
  const ctx = opts.ctx as ContextWithMarketUserInfo & {
    trustedClientToken?: string;
  };

  // Check if any authentication is available
  const hasAccessToken = !!ctx.marketAccessToken;
  const hasTrustedToken = !!ctx.trustedClientToken;

  if (!hasAccessToken && !hasTrustedToken) {
    const { TRPCError } = await import('@trpc/server');
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in.',
    });
  }

  return opts.next();
});

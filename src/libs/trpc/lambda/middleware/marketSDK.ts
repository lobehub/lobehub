import { type TrustedClientUserInfo } from '@/libs/trusted-client';
import { MarketService } from '@/server/services/market';

import { trpc } from '../init';

interface ContextWithMarketUserInfo {
  marketAccessToken?: string;
  marketUserInfo?: TrustedClientUserInfo;
}

/**
 * Middleware that initializes MarketService with proper authentication.
 * This requires marketUserInfo middleware to be applied first.
 *
 * Provides:
 * - ctx.marketSDK: MarketSDK instance for backward compatibility
 * - ctx.marketService: MarketService instance (recommended)
 */
export const marketSDK = trpc.middleware(async (opts) => {
  const ctx = opts.ctx as ContextWithMarketUserInfo;

  // Initialize MarketService with authentication
  const marketService = new MarketService({
    accessToken: ctx.marketAccessToken,
    userInfo: ctx.marketUserInfo,
  });

  return opts.next({
    ctx: {
      marketSDK: marketService.market, // Backward compatibility
      marketService, // New recommended way
    },
  });
});

/**
 * Middleware that requires authentication for Market API access.
 * This middleware ensures that either accessToken or marketUserInfo is available.
 * It should be used after marketUserInfo and marketSDK middlewares.
 *
 * Throws UNAUTHORIZED error if neither authentication method is available.
 */
export const requireMarketAuth = trpc.middleware(async (opts) => {
  const ctx = opts.ctx as ContextWithMarketUserInfo;

  // Check if any authentication is available
  const hasAccessToken = !!ctx.marketAccessToken;
  const hasUserInfo = !!ctx.marketUserInfo;

  if (!hasAccessToken && !hasUserInfo) {
    const { TRPCError } = await import('@trpc/server');
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in.',
    });
  }

  return opts.next();
});

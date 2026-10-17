import { publicProcedure } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DiscoverService } from '@/server/services/discover';
import { MarketService } from '@/server/services/market';

// Public procedure with optional user info for trusted client token
export const marketProcedure = publicProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    return next({
      ctx: {
        discoverService: new DiscoverService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
        marketService: new MarketService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
      },
    });
  });

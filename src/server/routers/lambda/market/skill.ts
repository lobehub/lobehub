import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';

const log = debug('lambda-router:market:skill');

// Public procedure with optional user info for trusted client token
const marketProcedure = publicProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    return next({
      ctx: {
        marketService: new MarketService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
      },
    });
  });

export const skillRouter = router({
  searchSkill: marketProcedure
    .input(
      z.object({
        locale: z.string().optional(),
        order: z.enum(['asc', 'desc']).optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
        q: z.string().optional(),
        sort: z
          .enum([
            'createdAt',
            'forks',
            'installCount',
            'name',
            'relevance',
            'stars',
            'updatedAt',
            'watchers',
          ])
          .optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('searchSkill input: %O', input);

      try {
        return await ctx.marketService.searchSkill(input);
      } catch (error) {
        log('Error searching skills: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to search skills',
        });
      }
    }),
});

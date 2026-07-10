import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { ChangelogService } from '@/server/services/changelog';

const changelogProcedure = publicProcedure.use(async ({ next }) => {
  return next({
    ctx: {
      changelogService: new ChangelogService(),
    },
  });
});

export const changelogRouter = router({
  getIndex: changelogProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.changelogService.getChangelogIndex();
    } catch (e) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch changelog index',
      });
    }
  }),

  getPostById: changelogProcedure
    .input(
      z.object({
        id: z.string(),
        locale: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        return await ctx.changelogService.getPostById(input.id, { locale: input.locale as any });
      } catch (e) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch changelog post',
        });
      }
    }),
});

export type ChangelogRouter = typeof changelogRouter;

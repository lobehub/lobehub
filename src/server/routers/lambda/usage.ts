import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { UsageRecordService } from '@/server/services/usage';

const usageProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      usageRecordService: new UsageRecordService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const usageRouter = router({
  findAndGroupByDateRange: usageProcedure
    .input(
      z.object({
        endAt: z.string(),
        startAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDateRange(input.startAt, input.endAt);
    }),

  findAndGroupByDay: usageProcedure
    .input(
      z.object({
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDay(input.mo);
    }),

  findByMonth: usageProcedure
    .input(
      z.object({
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findByMonth(input.mo);
    }),
});

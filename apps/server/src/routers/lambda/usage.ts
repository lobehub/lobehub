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
  getAgentUsageStats: usageProcedure
    .input(
      z.object({
        agentId: z.string(),
        endAt: z.string(),
        granularity: z.enum(['day', 'week']).default('day'),
        startAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.getAgentUsageStats(
        input.agentId,
        input.startAt,
        input.endAt,
        input.granularity,
      );
    }),

  findAndGroupByDateRange: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        endAt: z.string(),
        startAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDateRange(
        input.startAt,
        input.endAt,
        input.agentId,
      );
    }),

  findAndGroupByDay: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDay(input.mo, input.agentId);
    }),

  findByMonth: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findByMonth(input.mo, input.agentId);
    }),
});

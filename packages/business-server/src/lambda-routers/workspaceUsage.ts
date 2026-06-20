import { TRPCError } from '@trpc/server';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { messages, workspaceMembers } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { isSuperAdmin } from '../enterprise/superAdmin';

const usageProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceMemberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId),
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

const planLimits = {
  business: { members: 50, monthlyTokens: 50_000_000 },
  enterprise: { members: -1, monthlyTokens: -1 },
  starter: { members: 5, monthlyTokens: 2_000_000 },
};

const resolvePlan = (settings: Record<string, unknown>) => {
  const plan = settings.plan;
  return plan === 'starter' || plan === 'business' || plan === 'enterprise' ? plan : 'enterprise';
};

export const workspaceUsageRouter = router({
  summary: usageProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await ctx.workspaceMemberModel.getMember(input.workspaceId, ctx.userId);
      if (!membership && !(await isSuperAdmin(ctx.serverDB, ctx.userId)))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this workspace' });

      const [memberStats] = await ctx.serverDB
        .select({ count: count() })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            isNull(workspaceMembers.deletedAt),
          ),
        );

      const [messageStats] = await ctx.serverDB
        .select({
          cost: sql<number>`COALESCE(SUM((COALESCE(${messages.usage}, ${messages.metadata}->'usage')->>'cost')::numeric), 0)`.mapWith(
            Number,
          ),
          messages: count(),
          tokens:
            sql<number>`COALESCE(SUM((COALESCE(${messages.usage}, ${messages.metadata}->'usage')->>'totalTokens')::numeric), 0)`.mapWith(
              Number,
            ),
        })
        .from(messages)
        .where(eq(messages.workspaceId, input.workspaceId));

      return {
        cost: messageStats?.cost ?? 0,
        members: memberStats?.count ?? 0,
        messages: messageStats?.messages ?? 0,
        tokens: messageStats?.tokens ?? 0,
      };
    }),

  quotaStatus: usageProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await ctx.workspaceMemberModel.getMember(input.workspaceId, ctx.userId);
      if (!membership && !(await isSuperAdmin(ctx.serverDB, ctx.userId)))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this workspace' });

      const settings = (await ctx.workspaceModel.getSettings(input.workspaceId)) as Record<
        string,
        unknown
      >;
      const plan = resolvePlan(settings);
      const limits = planLimits[plan];

      const [memberStats] = await ctx.serverDB
        .select({ count: count() })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            isNull(workspaceMembers.deletedAt),
          ),
        );

      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [tokenStats] = await ctx.serverDB
        .select({
          tokens:
            sql<number>`COALESCE(SUM((COALESCE(${messages.usage}, ${messages.metadata}->'usage')->>'totalTokens')::numeric), 0)`.mapWith(
              Number,
            ),
        })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, input.workspaceId),
            sql`${messages.createdAt} >= ${monthStart}`,
          ),
        );

      const used = { members: memberStats?.count ?? 0, monthlyTokens: tokenStats?.tokens ?? 0 };

      return {
        exceeded: {
          members: limits.members !== -1 && used.members > limits.members,
          monthlyTokens: limits.monthlyTokens !== -1 && used.monthlyTokens > limits.monthlyTokens,
        },
        limits,
        plan,
        used,
      };
    }),
});

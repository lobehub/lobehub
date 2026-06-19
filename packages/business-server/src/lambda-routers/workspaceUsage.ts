import { TRPCError } from '@trpc/server';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { messages, workspaceMembers } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const usageProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceMemberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const workspaceUsageRouter = router({
  summary: usageProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await ctx.workspaceMemberModel.getMember(input.workspaceId, ctx.userId);
      if (!membership)
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
});

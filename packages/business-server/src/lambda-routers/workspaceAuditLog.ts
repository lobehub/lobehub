import { z } from 'zod';

import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const auditProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceAuditLogModel: new WorkspaceAuditLogModel(ctx.serverDB),
      workspaceMemberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const workspaceAuditLogRouter = router({
  list: auditProcedure
    .input(
      z.object({
        cursor: z.coerce.date().optional(),
        limit: z.number().min(1).max(100).optional(),
        workspaceId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const membership = await ctx.workspaceMemberModel.getMember(input.workspaceId, ctx.userId);
      if (membership?.role !== 'owner') return { items: [], nextCursor: null };

      return ctx.workspaceAuditLogModel.list(input);
    }),
});

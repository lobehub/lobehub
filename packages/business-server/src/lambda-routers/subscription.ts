import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { isSuperAdmin } from '../enterprise/superAdmin';

const planSchema = z.enum(['starter', 'business', 'enterprise']);

const plans = [
  {
    id: 'starter',
    limits: { members: 5, monthlyTokens: 2_000_000, workspaces: 1 },
    name: 'Starter',
  },
  {
    id: 'business',
    limits: { members: 50, monthlyTokens: 50_000_000, workspaces: 10 },
    name: 'Business',
  },
  {
    id: 'enterprise',
    limits: { members: -1, monthlyTokens: -1, workspaces: -1 },
    name: 'Enterprise',
  },
] as const;

const subscriptionProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceAuditLogModel: new WorkspaceAuditLogModel(ctx.serverDB),
      workspaceMemberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId),
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const subscriptionRouter = router({
  getWorkspacePlan: subscriptionProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await ctx.workspaceMemberModel.getMember(input.workspaceId, ctx.userId);
      if (!membership && !(await isSuperAdmin(ctx.serverDB, ctx.userId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this workspace' });
      }

      const settings = (await ctx.workspaceModel.getSettings(input.workspaceId)) as Record<
        string,
        unknown
      >;
      const parsedPlan = planSchema.safeParse(settings.plan);
      const plan = parsedPlan.success ? parsedPlan.data : 'enterprise';

      return { plan, plans };
    }),

  listPlans: authedProcedure.query(() => plans),

  setWorkspacePlan: subscriptionProcedure
    .input(z.object({ plan: planSchema, workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.workspaceMemberModel.getMember(input.workspaceId, ctx.userId);
      if (membership?.role !== 'owner' && !(await isSuperAdmin(ctx.serverDB, ctx.userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners can update workspace plan',
        });
      }

      const settings = (await ctx.workspaceModel.getSettings(input.workspaceId)) as Record<
        string,
        unknown
      >;
      await ctx.workspaceModel.updateSettings(input.workspaceId, { ...settings, plan: input.plan });
      await ctx.workspaceAuditLogModel.create({
        action: 'subscription.updated',
        ipAddress: ctx.clientIp ?? undefined,
        metadata: { plan: input.plan },
        resourceId: input.workspaceId,
        resourceType: 'workspace_subscription',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
    }),
});

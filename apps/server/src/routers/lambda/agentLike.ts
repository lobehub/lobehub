import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { wsProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AGENT_LIKE_AGENT_NOT_FOUND, AgentLikeModel } from '@/database/models/agentLike';
import { RbacModel } from '@/database/models/rbac';
import { workspaceMembers } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

const agentIdSchema = z.object({ agentId: z.string().trim().min(1).max(255) });

/** Permission codes of an active member; empty when the caller is not one. */
const agentLikeProcedure = wsProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  let permissionCodes: Promise<string[]> | undefined;
  const getPermissionCodes = () => {
    permissionCodes ??= Promise.all([
      ctx.serverDB
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
            eq(workspaceMembers.userId, ctx.userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1),
      new RbacModel(ctx.serverDB, ctx.userId).getUserPermissions({ workspaceId: ctx.workspaceId }),
    ]).then(([membership, codes]) => (membership[0] ? codes : []));
    return permissionCodes;
  };

  return next({
    ctx: {
      agentLikeModel: new AgentLikeModel(ctx.serverDB, ctx.userId, ctx.workspaceId),
      getAgentLikePermissionCodes: getPermissionCodes,
    },
  });
});

interface LikeContext {
  getAgentLikePermissionCodes: () => Promise<string[]>;
  serverDB: Parameters<typeof assertCanPerformResourceAction>[0]['db'];
  userId: string;
  workspaceId: string;
}

const assertMember = async (ctx: LikeContext) => {
  const grantedPermissions = await ctx.getAgentLikePermissionCodes();
  if (grantedPermissions.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Workspace membership required' });
  }
  return grantedPermissions;
};

/**
 * Liking is a read-level social action: any active member who can view the
 * agent may like it, so no dedicated RBAC code is consulted.
 */
const assertAgentView = async (ctx: LikeContext, agentId: string) => {
  const grantedPermissions = await assertMember(ctx);
  await assertCanPerformResourceAction({
    action: 'view',
    db: ctx.serverDB,
    grantedPermissions,
    resourceId: agentId,
    resourceType: 'agent',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

const toNotFound = (error: unknown): never => {
  if (error instanceof Error && error.message === AGENT_LIKE_AGENT_NOT_FOUND) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
  }
  throw error;
};

export const agentLikeRouter = router({
  like: agentLikeProcedure.input(agentIdSchema).mutation(async ({ ctx, input }) => {
    await assertAgentView(ctx, input.agentId);
    return ctx.agentLikeModel.like(input.agentId).catch(toNotFound);
  }),

  summaries: agentLikeProcedure.query(async ({ ctx }) => {
    await assertMember(ctx);
    return ctx.agentLikeModel.summaries();
  }),

  unlike: agentLikeProcedure.input(agentIdSchema).mutation(async ({ ctx, input }) => {
    await assertAgentView(ctx, input.agentId);
    return ctx.agentLikeModel.unlike(input.agentId).catch(toNotFound);
  }),
});

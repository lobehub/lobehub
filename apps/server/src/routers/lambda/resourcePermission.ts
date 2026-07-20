import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import {
  getDefaultResourceAccessLevel,
  PERMISSION_RESOURCE_TYPES,
  RESOURCE_ACCESS_LEVELS,
} from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  buildResourcePermissionState,
  canManageResourcePermission,
  getResourceMeta,
  isAccessLevelAllowed,
} from '@/server/services/resourcePermission';

import { getWorkspaceGroupVirtualAgentIds } from './_helpers/workspaceAgentGuard';

const resourceInput = z.object({
  resourceId: z.string(),
  resourceType: z.enum(PERMISSION_RESOURCE_TYPES),
});

const accessLevelSchema = z.enum(RESOURCE_ACCESS_LEVELS);
const legacyGeneralAccessSchema = z.enum(['editor', 'viewer']);

/**
 * Permission rows only exist inside a team workspace, so unlike the content
 * routers this one rejects personal-mode calls outright.
 */
const permissionProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  if (!ctx.workspaceId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Resource permissions only apply inside a workspace',
    });
  }

  return opts.next({
    ctx: {
      permissionModel: new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId),
      workspaceId: ctx.workspaceId,
    },
  });
});

export const resourcePermissionRouter = router({
  /**
   * The resource's publicity + General-access level plus the caller's own
   * capability, so the Permission panel renders in one query.
   */
  getGeneralAccess: permissionProcedure.input(resourceInput).query(async ({ ctx, input }) => {
    const meta = await getResourceMeta(ctx.serverDB, input.resourceType, input.resourceId);
    // Cross-workspace probing gets NOT_FOUND, same as a missing resource.
    if (!meta || meta.workspaceId !== ctx.workspaceId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
    }
    // Private rows are creator-only (mirrors `canPerformResourceAction`):
    // don't leak existence/creator of another member's private resource.
    if (meta.visibility === 'private' && meta.userId !== ctx.userId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
    }

    const [accessLevel, canManage] = await Promise.all([
      ctx.permissionModel.getEffectiveAccessLevel(input.resourceType, input.resourceId),
      canManageResourcePermission({
        db: ctx.serverDB,
        grantedPermissions: (ctx as { workspacePermissionCodes?: string[] })
          .workspacePermissionCodes,
        meta,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ]);

    return buildResourcePermissionState({
      accessLevel,
      canManage,
      creatorId: meta.userId,
      visibility: (meta.visibility ?? 'public') as 'private' | 'public',
    });
  }),

  /**
   * Set the explicit Workspace General-access level (creator or workspace owner).
   */
  setGeneralAccess: permissionProcedure
    .input(
      resourceInput
        .extend({
          accessLevel: accessLevelSchema.optional(),
          /** @deprecated Compatibility for released clients. */
          role: legacyGeneralAccessSchema.optional(),
        })
        .refine(({ accessLevel, role }) => accessLevel !== undefined || role !== undefined, {
          message: 'accessLevel is required',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const meta = await getResourceMeta(ctx.serverDB, input.resourceType, input.resourceId);
      if (!meta || meta.workspaceId !== ctx.workspaceId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
      }
      // Same private-row existence guard as `getGeneralAccess`.
      if (meta.visibility === 'private' && meta.userId !== ctx.userId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
      }

      const canManage = await canManageResourcePermission({
        db: ctx.serverDB,
        grantedPermissions: (ctx as { workspacePermissionCodes?: string[] })
          .workspacePermissionCodes,
        meta,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      if (!canManage) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator or a workspace owner can change general access',
        });
      }

      if (meta.visibility === 'private') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Private resources do not have Workspace access',
        });
      }

      const accessLevel =
        input.accessLevel ??
        (input.role === 'editor' ? 'edit' : getDefaultResourceAccessLevel(input.resourceType));
      if (!isAccessLevelAllowed(input.resourceType, accessLevel)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${accessLevel} access is not supported for ${input.resourceType}`,
        });
      }

      await ctx.permissionModel.setAccessLevel(
        input.resourceType,
        input.resourceId,
        accessLevel,
        ctx.userId,
      );

      // A group's General Access speaks for the whole group: cascade the level
      // to its group-owned virtual agents (supervisor + members), whose
      // effective access is min(own, parent group). Standalone agents linked
      // into the group keep their own ACL.
      if (input.resourceType === 'agentGroup') {
        const virtualAgentIds = await getWorkspaceGroupVirtualAgentIds({
          db: ctx.serverDB,
          groupId: input.resourceId,
          workspaceId: ctx.workspaceId,
        });
        await Promise.all(
          virtualAgentIds.map((agentId) =>
            ctx.permissionModel.setAccessLevel('agent', agentId, accessLevel, ctx.userId),
          ),
        );
      }

      return buildResourcePermissionState({
        accessLevel,
        canManage: true,
        creatorId: meta.userId,
        visibility: 'public',
      });
    }),
});

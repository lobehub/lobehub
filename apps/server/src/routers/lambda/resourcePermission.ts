import { MAX_RESOURCE_COLLABORATORS_PER_ADD } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import {
  getDefaultResourceAccessLevel,
  getLegacyViewerAccessLevel,
  PERMISSION_RESOURCE_TYPES,
  RESOURCE_ACCESS_LEVELS,
  users,
  workspaceMembers,
} from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type { ResourceMeta } from '@/server/services/resourcePermission';
import {
  buildResourcePermissionState,
  canManageResourcePermission,
  getResourceMeta,
  isAccessLevelAllowed,
  isCollaborativeBuiltinAgent,
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

/**
 * Shared guard of every permission-management procedure: resolve the resource
 * within the caller's workspace (cross-workspace and foreign-private probing
 * both read as NOT_FOUND) and require management authority over it.
 */
const loadManageableResource = async (
  ctx: {
    serverDB: Parameters<typeof getResourceMeta>[0];
    userId: string;
    workspaceId: string;
    workspacePermissionCodes?: string[];
  },
  input: { resourceId: string; resourceType: (typeof PERMISSION_RESOURCE_TYPES)[number] },
): Promise<ResourceMeta> => {
  const meta = await getResourceMeta(ctx.serverDB, input.resourceType, input.resourceId);
  if (!meta || meta.workspaceId !== ctx.workspaceId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
  }
  if (meta.visibility === 'private' && meta.userId !== ctx.userId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
  }

  const canManage = await canManageResourcePermission({
    db: ctx.serverDB,
    grantedPermissions: ctx.workspacePermissionCodes,
    meta,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  if (!canManage) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the creator or a workspace owner can manage member permissions',
    });
  }

  return meta;
};

export const resourcePermissionRouter = router({
  /**
   * Grant a batch of workspace members a collaborator level on one resource.
   * The creator is silently skipped (they already hold full access), and every
   * target must be an active member of the workspace.
   */
  addCollaborators: permissionProcedure
    .input(
      resourceInput.extend({
        accessLevel: accessLevelSchema,
        userIds: z.array(z.string()).min(1).max(MAX_RESOURCE_COLLABORATORS_PER_ADD),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meta = await loadManageableResource(ctx, input);

      if (!isAccessLevelAllowed(input.resourceType, input.accessLevel)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${input.accessLevel} access is not supported for ${input.resourceType}`,
        });
      }

      const targetIds = [...new Set(input.userIds)].filter((id) => id !== meta.userId);
      if (targetIds.length === 0) return { success: true };

      // Check membership and write the grants under one transaction, holding a
      // row lock on the membership rows for its duration. `removeMember` takes
      // the same locks before revoking a departing member's grants, so the two
      // serialise: either this commits first and the revoke sweeps up what it
      // wrote, or the removal commits first and the locked read below sees the
      // soft delete and refuses. Without the lock the check could pass against
      // a membership that is deleted before the upsert lands, leaving a grant
      // that re-inviting the member silently revives.
      await ctx.serverDB.transaction(async (tx) => {
        const activeMembers = await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, ctx.workspaceId),
              inArray(workspaceMembers.userId, targetIds),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .for('update');
        if (activeMembers.length !== targetIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Every collaborator must be an active member of the workspace',
          });
        }

        await new ResourcePermissionModel(tx, ctx.workspaceId).upsertCollaborators({
          accessLevel: input.accessLevel,
          createdBy: ctx.userId,
          resourceId: input.resourceId,
          resourceType: input.resourceType,
          userIds: targetIds,
        });
      });

      return { success: true };
    }),

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

    const [explicitAccessLevel, canManage] = await Promise.all([
      ctx.permissionModel.getAccessLevel(input.resourceType, input.resourceId),
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

    // A collaborative builtin with no explicit row is editable by every capable
    // member (`canPerformResourceAction`), so report that as its access level
    // rather than the resource default — the client's config gate reads this
    // field, and `canManage` deliberately stays author/admin-only for these rows.
    const accessLevel =
      explicitAccessLevel ??
      (isCollaborativeBuiltinAgent(input.resourceType, meta)
        ? 'edit'
        : getDefaultResourceAccessLevel(input.resourceType));

    return buildResourcePermissionState({
      accessLevel,
      canManage,
      creatorId: meta.userId,
      visibility: (meta.visibility ?? 'public') as 'private' | 'public',
    });
  }),

  /**
   * The collaborator grants of one resource with each member's display
   * profile, for the Permission page. Manager-only, like the page itself.
   */
  listCollaborators: permissionProcedure.input(resourceInput).query(async ({ ctx, input }) => {
    await loadManageableResource(ctx, input);

    // The model only returns per-member rows, so `userId` is always set — the
    // filter narrows the nullable column type, not the data.
    const grants = (
      await ctx.permissionModel.listCollaborators(input.resourceType, input.resourceId)
    ).filter((row): row is typeof row & { userId: string } => row.userId !== null);
    if (grants.length === 0) return [];

    const profiles = await ctx.serverDB
      .select({
        avatar: users.avatar,
        email: users.email,
        fullName: users.fullName,
        id: users.id,
        username: users.username,
      })
      .from(users)
      .where(
        inArray(
          users.id,
          grants.map((row) => row.userId),
        ),
      );
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

    return grants.map((row) => ({
      accessLevel: row.accessLevel,
      createdAt: row.createdAt,
      user: profileMap.get(row.userId) ?? null,
      userId: row.userId,
    }));
  }),

  /** Revoke one member's collaborator grant on a resource. */
  removeCollaborator: permissionProcedure
    .input(resourceInput.extend({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadManageableResource(ctx, input);

      await ctx.permissionModel.removeCollaborators(input.resourceType, input.resourceId, [
        input.userId,
      ]);

      return { success: true };
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

      // A private resource may carry a level too: it is the creator deciding
      // what members get the moment they publish, and the publish paths read it
      // back instead of overwriting with the default. It grants nothing while
      // private — visibility, not this row, is what lets a member in — and
      // demoting to private clears the row again (`removeAll`). The
      // creator-only guard above already keeps other members out.

      // A released client sends only `role`, and its `viewer` is an explicit
      // "less than editor" choice — resolve it through the legacy map, never
      // through the default (which is `edit` for agents and groups).
      const accessLevel =
        input.accessLevel ??
        (input.role === 'editor' ? 'edit' : getLegacyViewerAccessLevel(input.resourceType));
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
        visibility: (meta.visibility ?? 'public') as 'private' | 'public',
      });
    }),
});

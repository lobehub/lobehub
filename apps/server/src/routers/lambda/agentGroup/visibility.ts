import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import type { ResourceAccessLevel } from '@/database/schemas';
import { DEFAULT_RESOURCE_ACCESS_LEVELS, RESOURCE_ACCESS_LEVELS_BY_TYPE } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import {
  assertCanPerformResourceAction,
  buildResourcePermissionState,
} from '@/server/services/resourcePermission';

import { getWorkspaceGroupVirtualAgentIds } from '../_helpers/workspaceAgentGuard';
import { agentGroupProcedureWrite, PERMISSION_WRITE_CONCURRENCY } from './procedures';

/**
 * Write a group's access level onto the group AND the group-owned virtual
 * agents (supervisor + generated members).
 *
 * The cascade is not decorative: `assertCanEditResource` authorizes an agent by
 * that agent's OWN ACL, with no parent-group term. A virtual agent left without
 * a row falls back to the agent default (`edit`), so publishing a group as
 * `use`/`view` while skipping the cascade leaves its supervisor editable by
 * every member who can resolve its id — the group restriction would apply to
 * the group resource only. Mirrors `resourcePermission.setGeneralAccess`;
 * standalone agents linked into the group keep their own ACL.
 */
export const applyGroupAccessLevel = async ({
  accessLevel,
  ctx,
  groupId,
  permissionModel,
  workspaceId,
}: {
  accessLevel: ResourceAccessLevel;
  ctx: { serverDB: LobeChatDatabase; userId: string };
  groupId: string;
  permissionModel: ResourcePermissionModel;
  workspaceId: string;
}): Promise<void> => {
  const virtualAgentIds = await getWorkspaceGroupVirtualAgentIds({
    db: ctx.serverDB,
    groupId,
    workspaceId,
  });

  await Promise.all([
    permissionModel.setAccessLevel('agentGroup', groupId, accessLevel, ctx.userId),
    pMap(
      virtualAgentIds,
      (agentId) => permissionModel.setAccessLevel('agent', agentId, accessLevel, ctx.userId),
      { concurrency: PERMISSION_WRITE_CONCURRENCY },
    ),
  ]);
};

export const visibilityRouter = router({
  /**
   * Publish a private chat group into the workspace. One-way: once shared,
   * other workspace members may already be using it, so we never let it slip
   * back to `private`. Restricted to the creator's own still-private group.
   */
  publishGroupToWorkspace: agentGroupProcedureWrite
    .input(
      z.object({
        accessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agentGroup).optional(),
        id: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Same rule `setGroupVisibility` enforces, on the other route to the same
      // transition: a private group may hold the creator's private member
      // agents, and publishing the group without them leaves everyone else
      // with a group whose members they cannot see. Guarding only one of two
      // publish paths guards neither.
      if (ctx.workspaceId) {
        const privateMembers = await ctx.chatGroupModel.countPrivateGroupAgents(input.id);

        if (privateMembers > 0)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Cannot publish a group that still contains private agents. Publish or remove those agents first.',
          });
      }

      const result = await ctx.chatGroupModel.publishToWorkspace(input.id);
      if (ctx.workspaceId) {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        // Same rule as `publishAgentToWorkspace`: an explicit request wins;
        // otherwise keep whatever the creator already chose on the Permission
        // page while the group was still private — rewriting the default here
        // would silently discard that decision.
        const accessLevel =
          input.accessLevel ??
          (await permissionModel.getAccessLevel('agentGroup', input.id)) ??
          DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup;
        await applyGroupAccessLevel({
          accessLevel,
          ctx,
          groupId: input.id,
          permissionModel,
          workspaceId: ctx.workspaceId,
        });
      }
      return result;
    }),
  /**
   * Bidirectional visibility switch for the Permission panel, mirroring
   * `agent.setAgentVisibility`:
   * - demoting to private stays creator-only (an owner-initiated demotion
   *   would appropriate the creator's group);
   * - publishing may also be done by a workspace owner (`AGENT_UPDATE:all`)
   *   or a granted `manager` collaborator.
   */
  setGroupVisibility: agentGroupProcedureWrite
    .input(
      z.object({
        accessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agentGroup).optional(),
        id: z.string(),
        visibility: z.enum(['private', 'public']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Group visibility only applies inside a workspace',
        });
      }

      const group = await ctx.chatGroupModel.findById(input.id);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });

      const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
      const privateMembersPromise =
        input.visibility === 'public' && group.visibility !== input.visibility
          ? ctx.chatGroupModel.countPrivateGroupAgents(input.id)
          : Promise.resolve(0);
      const [, privateMembers] = await Promise.all([
        assertCanPerformResourceAction({
          action: 'changeVisibility',
          db: ctx.serverDB,
          grantedPermissions: (ctx as { workspacePermissionCodes?: string[] })
            .workspacePermissionCodes,
          meta: {
            userId: group.userId,
            visibility: group.visibility,
            workspaceId: group.workspaceId,
          },
          resourceId: input.id,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
        privateMembersPromise,
      ]);
      if (group.visibility === input.visibility) {
        const accessLevel =
          input.visibility === 'public'
            ? (input.accessLevel ??
              (await permissionModel.getEffectiveAccessLevel('agentGroup', input.id)))
            : 'edit';
        if (input.visibility === 'public' && input.accessLevel) {
          await permissionModel.setAccessLevel(
            'agentGroup',
            input.id,
            input.accessLevel,
            ctx.userId,
          );
        }
        return buildResourcePermissionState({
          accessLevel,
          canManage: true,
          creatorId: group.userId,
          visibility: input.visibility,
        });
      }

      // A private group may hold the creator's private member agents; those
      // would leak to every member on publish. Reject until the members are
      // published or removed (mirrors the composite rule in addAgentsToGroup).
      if (input.visibility === 'public' && privateMembers > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot publish a group that still contains private agents. Publish or remove those agents first.',
        });
      }

      const updated = await ctx.chatGroupModel.setVisibility(input.id, input.visibility);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });

      let accessLevel: ResourceAccessLevel;
      if (input.visibility === 'private') {
        accessLevel = 'edit';
        await permissionModel.removeAll('agentGroup', input.id);
      } else {
        // Same rule as `publishGroupToWorkspace`: promotion keeps a level the
        // creator already set while private instead of resetting to the default.
        accessLevel =
          input.accessLevel ??
          (await permissionModel.getAccessLevel('agentGroup', input.id)) ??
          DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup;
        await applyGroupAccessLevel({
          accessLevel,
          ctx,
          groupId: input.id,
          permissionModel,
          workspaceId: ctx.workspaceId,
        });
      }

      return buildResourcePermissionState({
        accessLevel,
        canManage: true,
        creatorId: group.userId,
        visibility: input.visibility,
      });
    }),
});

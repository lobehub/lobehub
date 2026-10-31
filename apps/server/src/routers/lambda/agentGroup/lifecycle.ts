import { AgentPluginEntrySchema, InsertChatGroupSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import { type ChatGroupConfig } from '@/database/types/chatGroup';
import { router } from '@/libs/trpc/lambda';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
} from '@/server/services/resourcePermission';
import { TransferErrorCode } from '@/types/transferError';

import { isWorkspaceNonOwner } from '../_helpers/assertWorkspaceRowManageable';
import {
  agentGroupProcedureWrite,
  agentMemberInputSchema,
  PERMISSION_WRITE_CONCURRENCY,
} from './procedures';

export const lifecycleRouter = router({
  /**
   * Create a group with a supervisor agent.
   * The supervisor agent is automatically created as a virtual agent.
   * Returns the groupId and supervisorAgentId.
   */
  createGroup: agentGroupProcedureWrite
    .input(InsertChatGroupSchema)
    .mutation(async ({ input, ctx }) => {
      const { group, supervisorAgentId } = await ctx.agentGroupRepo.createGroupWithSupervisor({
        ...input,
        config: ctx.agentGroupService.normalizeGroupConfig(input.config as ChatGroupConfig | null),
      });

      if (ctx.workspaceId && group.visibility !== 'private') {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all([
          permissionModel.setAccessLevel(
            'agentGroup',
            group.id,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup,
            ctx.userId,
          ),
          permissionModel.setAccessLevel(
            'agent',
            supervisorAgentId,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
            ctx.userId,
          ),
        ]);
      }

      return { group, supervisorAgentId };
    }),
  /**
   * Create a group with virtual member agents in one request.
   * This is the recommended way to create a group from a template.
   * The backend will:
   * 1. Create a supervisor agent (virtual)
   * 2. Batch create virtual agents from member configs
   * 3. Create the group with supervisor and member agents
   * Returns the groupId, supervisorAgentId, and created member agentIds.
   */
  createGroupWithMembers: agentGroupProcedureWrite
    .input(
      z.object({
        groupConfig: InsertChatGroupSchema,
        members: z.array(agentMemberInputSchema),
        supervisorConfig: z
          .object({
            avatar: z.string().nullish(),
            backgroundColor: z.string().nullish(),
            chatConfig: z.any().nullish(),
            description: z.string().nullish(),
            model: z.string().nullish(),
            params: z.any().nullish(),
            plugins: z.array(AgentPluginEntrySchema).nullish(),
            provider: z.string().nullish(),
            systemRole: z.string().nullish(),
            tags: z.array(z.string()).nullish(),
            title: z.string().nullish(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Resolve the folder BEFORE creating the member agents. The same check
      // runs inside `createGroupWithSupervisor`, but that happens after these
      // inserts and outside their transaction, so a bad folder id would leave
      // orphaned virtual agents behind.
      const groupFolderId = input.groupConfig?.groupId;
      let folderVisibility: 'private' | 'public' | undefined;

      if (groupFolderId) {
        folderVisibility = await ctx.agentGroupRepo.getAssignableFolderVisibility(groupFolderId);
        const requested = input.groupConfig?.visibility;

        if (requested && requested !== folderVisibility)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `A ${requested} chat group cannot be created in a ${folderVisibility} folder`,
          });
      }

      // The synthetic members inherit the group's visibility, the same way the
      // supervisor does. Left to the column default they would be public
      // workspace resources while their group is private — visible to
      // permission checks that look agents up by id rather than through the
      // group. Must match `createGroupWithSupervisor`'s own derivation.
      const groupVisibility = input.groupConfig?.visibility ?? folderVisibility ?? undefined;

      // 1. Batch create virtual member agents
      const memberConfigs = input.members.map((member) => ({
        ...member,
        // See the `batchCreateAgentsInGroup` cast above for why this bridges
        // to `string[]` instead of failing type-check.
        plugins: member.plugins as unknown as string[] | undefined,
        tags: member.tags as string[] | undefined,
        virtual: true,
        ...(groupVisibility ? { visibility: groupVisibility } : {}),
      }));

      const createdAgents = await ctx.agentModel.batchCreate(memberConfigs);
      const memberAgentIds = createdAgents.map((agent) => agent.id);

      // 2. Create group with supervisor and member agents
      // Filter out null/undefined values from supervisorConfig
      const supervisorConfig = input.supervisorConfig
        ? Object.fromEntries(Object.entries(input.supervisorConfig).filter(([_, v]) => v != null))
        : undefined;

      const normalizedConfig = ctx.agentGroupService.normalizeGroupConfig(
        input.groupConfig.config as ChatGroupConfig | null,
      );

      const { group, supervisorAgentId } = await ctx.agentGroupRepo.createGroupWithSupervisor(
        {
          ...input.groupConfig,
          config: normalizedConfig,
        },
        memberAgentIds,
        supervisorConfig as any,
      );

      if (ctx.workspaceId && group.visibility !== 'private') {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all([
          permissionModel.setAccessLevel(
            'agentGroup',
            group.id,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup,
            ctx.userId,
          ),
          permissionModel.setAccessLevel(
            'agent',
            supervisorAgentId,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
            ctx.userId,
          ),
          pMap(
            createdAgents.filter((agent) => agent.visibility !== 'private'),
            (agent) =>
              permissionModel.setAccessLevel(
                'agent',
                agent.id,
                DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
                ctx.userId,
              ),
            { concurrency: PERMISSION_WRITE_CONCURRENCY },
          ),
        ]);
      }

      return { agentIds: memberAgentIds, groupId: group.id, supervisorAgentId };
    }),
  /**
   * Duplicate a chat group with all its members.
   * Creates a new group with the same config, a new supervisor, and copies of virtual members.
   * Non-virtual members are referenced (not copied).
   */
  duplicateGroup: agentGroupProcedureWrite
    .input(
      z.object({
        groupId: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Duplicating copies the group config + virtual member agent details,
      // which a use-only member must not be able to inspect — same edit gate
      // as `updateGroup`, mirroring the UI's `canEditResource` guard.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.groupId,
        resourceType: 'agentGroup',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      const result = await ctx.agentGroupRepo.duplicate(input.groupId, input.newTitle);
      if (ctx.workspaceId && result) {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all([
          permissionModel.setAccessLevel(
            'agentGroup',
            result.groupId,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup,
            ctx.userId,
          ),
          permissionModel.setAccessLevel(
            'agent',
            result.supervisorAgentId,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
            ctx.userId,
          ),
        ]);
      }
      return result;
    }),
  updateGroup: agentGroupProcedureWrite
    .input(
      z.object({
        id: z.string(),
        value: InsertChatGroupSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // General-access write guard: only `edit` permits collaborative updates.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.id,
        resourceType: 'agentGroup',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      // Collaborative edit lock: reject writes to a workspace group another
      // member is actively editing. Inert until a client acquires the lock.
      if (ctx.workspaceId) {
        const blockedBy = await ctx.editLockService.getBlockingHolder('chatGroup', input.id);
        if (blockedBy) {
          throw new TRPCError({
            cause: { data: { code: 'DocumentLocked' } },
            code: 'CONFLICT',
            message: 'Group is being edited by another user',
          });
        }
      }

      return ctx.chatGroupModel.update(input.id, {
        ...input.value,
        config: ctx.agentGroupService.normalizeGroupConfig(
          input.value.config as ChatGroupConfig | null,
        ),
      });
    }),
  deleteGroup: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'delete',
          db: ctx.serverDB,
          resourceId: input.id,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        // Same rule as transfer: deleting the group cascades topics/threads/
        // messages via FK, so a non-owner member must not erase teammates'
        // conversations along with their own group.
        if (
          isWorkspaceNonOwner(ctx) &&
          (await ctx.agentGroupRepo.transferHasForeignRows(input.id))
        ) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: "Only workspace owners can delete a group carrying others' conversations",
          });
        }
      }
      const result = await ctx.agentGroupService.deleteGroup(input.id);
      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'agentGroup',
          input.id,
        );
        // A deleted group can no longer be handed over — void any live request.
        await new ResourceTransferRequestModel(
          ctx.serverDB,
          ctx.workspaceId,
        ).invalidateForResources('agentGroup', [input.id]);
      }
      return result;
    }),
});

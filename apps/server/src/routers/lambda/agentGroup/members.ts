import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AGENT_COPY_IN_PROGRESS } from '@/database/models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS } from '@/database/models/agentTransferJob';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import { GROUP_MEMBER_ROLES } from '@/database/utils/groupMembership';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
} from '@/server/services/resourcePermission';

import {
  agentGroupProcedure,
  agentGroupProcedureWrite,
  agentMemberInputSchema,
} from './procedures';

export const membersProcedures = {
  addAgentsToGroup: agentGroupProcedureWrite
    .input(
      z.object({
        agentIds: z.array(z.string()),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.chatGroupModel.addAgentsToGroup(input.groupId, input.agentIds);
    }),
  /**
   * Batch create virtual agents and add them to an existing group.
   * This is more efficient than calling createAgentOnly multiple times.
   */
  batchCreateAgentsInGroup: agentGroupProcedureWrite
    .input(
      z.object({
        agents: z.array(agentMemberInputSchema),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      // Batch create virtual agents
      const agentConfigs = input.agents.map((agent) => ({
        ...agent,
        // `agentModel.batchCreate`'s config type is still `plugins?: string[]`
        // (widening deferred to the tri-state rollout's final phase); the
        // zod schema above already allows the tri-state object shape through.
        plugins: agent.plugins as unknown as string[] | undefined,
        tags: agent.tags as string[] | undefined,
        virtual: true,
      }));

      const createdAgents = await ctx.agentModel.batchCreate(agentConfigs);
      const agentIds = createdAgents.map((agent) => agent.id);

      // Add all agents to the group
      await ctx.chatGroupModel.addAgentsToGroup(input.groupId, agentIds);

      if (ctx.workspaceId) {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        // Group-owned members inherit the group's current General Access so a
        // group already opened to `edit` doesn't spawn `use`-locked members.
        const groupLevel = await permissionModel.getAccessLevel('agentGroup', input.groupId);
        await Promise.all(
          createdAgents
            .filter((agent) => agent.visibility !== 'private')
            .map((agent) =>
              permissionModel.setAccessLevel(
                'agent',
                agent.id,
                groupLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
                ctx.userId,
              ),
            ),
        );
      }

      return { agentIds, agents: createdAgents };
    }),
  checkAgentsBeforeRemoval: agentGroupProcedure
    .input(
      z.object({
        agentIds: z.array(z.string()),
        groupId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.groupId,
        resourceType: 'agentGroup',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      return ctx.agentGroupRepo.checkAgentsBeforeRemoval(input.groupId, input.agentIds);
    }),
  /**
   * Remove agents from a group.
   * - Non-virtual agents are simply removed from the group (agent still exists)
   * - Virtual agents are permanently deleted along with removal from group
   *
   * @param groupId - The group to remove agents from
   * @param agentIds - Array of agent IDs to remove
   * @param deleteVirtualAgents - Whether to delete virtual agents (default: true)
   */
  removeAgentsFromGroup: agentGroupProcedureWrite
    .input(
      z.object({
        agentIds: z.array(z.string()),
        deleteVirtualAgents: z.boolean().optional(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      try {
        return await ctx.agentGroupRepo.removeAgentsFromGroup(
          input.groupId,
          input.agentIds,
          input.deleteVirtualAgents,
        );
      } catch (error) {
        // A backfill still maps these agents' message rows — removing a member
        // now would strand the job on a dangling `messages.agent_id`.
        if (error instanceof Error && error.message === AGENT_TRANSFER_IN_PROGRESS) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: "A previous transfer of this group's agents is still migrating history",
          });
        }
        if (error instanceof Error && error.message === AGENT_COPY_IN_PROGRESS) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A previous copy of this agent is still duplicating its history',
          });
        }
        throw error;
      }
    }),
  updateAgentInGroup: agentGroupProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string(),
        updates: z.object({
          enabled: z.boolean().optional(),
          order: z.number().optional(),
          // Closed set rather than free text: `role` decides how the runtime
          // treats a member, and `supervisor` in particular carries the
          // lifecycle invariant the delete/transfer paths rely on. An unknown
          // string here used to be accepted and then quietly behave as
          // "not a supervisor" everywhere.
          role: z.enum(GROUP_MEMBER_ROLES).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.chatGroupModel.updateAgentInGroup(input.groupId, input.agentId, input.updates);
    }),
};

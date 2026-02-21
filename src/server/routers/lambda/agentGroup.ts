import { InsertChatGroupSchema } from '@lobechat/types';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { UserModel } from '@/database/models/user';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { insertAgentSchema } from '@/database/schemas';
import { type ChatGroupConfig } from '@/database/types/chatGroup';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentGroupService } from '@/server/services/agentGroup';

const agentGroupProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentGroupRepo: new AgentGroupRepository(ctx.serverDB, ctx.userId),
      agentGroupService: new AgentGroupService(ctx.serverDB, ctx.userId),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      chatGroupModel: new ChatGroupModel(ctx.serverDB, ctx.userId),
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const agentGroupRouter = router({
  addAgentsToGroup: agentGroupProcedure
    .input(
      z.object({
        agentIds: z.array(z.string()),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.chatGroupModel.addAgentsToGroup(input.groupId, input.agentIds);
    }),

  /**
   * Batch create virtual agents and add them to an existing group.
   * This is more efficient than calling createAgentOnly multiple times.
   */
  batchCreateAgentsInGroup: agentGroupProcedure
    .input(
      z.object({
        agents: z.array(
          insertAgentSchema
            .omit({
              chatConfig: true,
              openingMessage: true,
              openingQuestions: true,
              tts: true,
              userId: true,
            })
            .partial(),
        ),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Batch create virtual agents
      const agentConfigs = input.agents.map((agent) => ({
        ...agent,
        plugins: agent.plugins as string[] | undefined,
        tags: agent.tags as string[] | undefined,
        virtual: true,
      }));

      const createdAgents = await ctx.agentModel.batchCreate(agentConfigs);
      const agentIds = createdAgents.map((agent) => agent.id);

      // Add all agents to the group
      await ctx.chatGroupModel.addAgentsToGroup(input.groupId, agentIds);

      return { agentIds, agents: createdAgents };
    }),

  /**
   * Check agents before removal to identify virtual agents that will be permanently deleted.
   * This allows the frontend to show a confirmation dialog.
   */
  checkAgentsBeforeRemoval: agentGroupProcedure
    .input(
      z.object({
        agentIds: z.array(z.string()),
        groupId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentGroupRepo.checkAgentsBeforeRemoval(input.groupId, input.agentIds);
    }),

  /**
   * Create a group with a supervisor agent.
   * The supervisor agent is automatically created as a virtual agent.
   * Returns the groupId and supervisorAgentId.
   */
  createGroup: agentGroupProcedure.input(InsertChatGroupSchema).mutation(async ({ input, ctx }) => {
    const { group, supervisorAgentId } = await ctx.agentGroupRepo.createGroupWithSupervisor({
      ...input,
      config: ctx.agentGroupService.normalizeGroupConfig(input.config as ChatGroupConfig | null),
    });

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
  createGroupWithMembers: agentGroupProcedure
    .input(
      z.object({
        groupConfig: InsertChatGroupSchema,
        members: z.array(
          insertAgentSchema
            .omit({
              chatConfig: true,
              openingMessage: true,
              openingQuestions: true,
              tts: true,
              userId: true,
            })
            .partial(),
        ),
        supervisorConfig: z
          .object({
            avatar: z.string().nullish(),
            backgroundColor: z.string().nullish(),
            chatConfig: z.any().nullish(),
            description: z.string().nullish(),
            model: z.string().nullish(),
            params: z.any().nullish(),
            plugins: z.array(z.string()).nullish(),
            provider: z.string().nullish(),
            systemRole: z.string().nullish(),
            tags: z.array(z.string()).nullish(),
            title: z.string().nullish(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // 1. Batch create virtual member agents
      const memberConfigs = input.members.map((member) => ({
        ...member,
        plugins: member.plugins as string[] | undefined,
        tags: member.tags as string[] | undefined,
        virtual: true,
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

      return { agentIds: memberAgentIds, groupId: group.id, supervisorAgentId };
    }),

  deleteGroup: agentGroupProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentGroupService.deleteGroup(input.id);
    }),

  /**
   * Duplicate a chat group with all its members.
   * Creates a new group with the same config, a new supervisor, and copies of virtual members.
   * Non-virtual members are referenced (not copied).
   */
  duplicateGroup: agentGroupProcedure
    .input(
      z.object({
        groupId: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentGroupRepo.duplicate(input.groupId, input.newTitle);
    }),

  getGroup: agentGroupProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.chatGroupModel.findById(input.id);
    }),

  getGroupAgents: agentGroupProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.chatGroupModel.getGroupAgents(input.groupId);
    }),

  /**
   * Get a group by forkedFromIdentifier stored in config
   * @returns group id if exists, null otherwise
   */
  getGroupByForkedFromIdentifier: agentGroupProcedure
    .input(
      z.object({
        forkedFromIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.chatGroupModel.getGroupByForkedFromIdentifier(input.forkedFromIdentifier);
    }),

  getGroupDetail: agentGroupProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [defaultAgentConfig, detail] = await Promise.all([
        ctx.userModel.getUserSettingsDefaultAgentConfig(),
        ctx.agentGroupService.getGroupDetail(input.id),
      ]);

      if (!detail) return null;

      return {
        ...detail,
        agents: ctx.agentGroupService.mergeAgentsDefaultConfig(defaultAgentConfig, detail.agents),
      };
    }),

  getGroups: agentGroupProcedure.query(async ({ ctx }) => {
    const [defaultAgentConfig, groups] = await Promise.all([
      ctx.userModel.getUserSettingsDefaultAgentConfig(),
      ctx.agentGroupService.getGroups(),
    ]);

    return groups.map((group) => ({
      ...group,
      agents: ctx.agentGroupService.mergeAgentsDefaultConfig(defaultAgentConfig, group.agents),
    }));
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
  removeAgentsFromGroup: agentGroupProcedure
    .input(
      z.object({
        agentIds: z.array(z.string()),
        deleteVirtualAgents: z.boolean().optional(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentGroupRepo.removeAgentsFromGroup(
        input.groupId,
        input.agentIds,
        input.deleteVirtualAgents,
      );
    }),

  updateAgentInGroup: agentGroupProcedure
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string(),
        updates: z.object({
          enabled: z.boolean().optional(),
          order: z.number().optional(),
          role: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.chatGroupModel.updateAgentInGroup(input.groupId, input.agentId, input.updates);
    }),

  updateGroup: agentGroupProcedure
    .input(
      z.object({
        id: z.string(),
        value: InsertChatGroupSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.chatGroupModel.update(input.id, {
        ...input.value,
        config: ctx.agentGroupService.normalizeGroupConfig(
          input.value.config as ChatGroupConfig | null,
        ),
      });
    }),
});

export type AgentGroupRouter = typeof agentGroupRouter;

import { AgentPluginEntrySchema, InsertChatGroupSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { UserModel } from '@/database/models/user';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { type ChatGroupConfig } from '@/database/types/chatGroup';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentGroupService } from '@/server/services/agentGroup';
import { EditLockService } from '@/server/services/editLock';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

/**
 * Custom schema for agent member input, replacing drizzle-generated insertAgentSchema
 * to avoid Json type inference issues with jsonb columns.
 */
const agentMemberInputSchema = z
  .object({
    agencyConfig: z.any().nullish(),
    avatar: z.string().nullish(),
    backgroundColor: z.string().nullish(),
    clientId: z.string().nullish(),
    description: z.string().nullish(),
    editorData: z.any().nullish(),
    fewShots: z.any().nullish(),
    id: z.string().optional(),
    marketIdentifier: z.string().nullish(),
    model: z.string().nullish(),
    params: z.any().nullish(),
    pinned: z.boolean().nullish(),
    plugins: z.array(AgentPluginEntrySchema).nullish(),
    provider: z.string().nullish(),
    sessionGroupId: z.string().nullish(),
    slug: z.string().nullish(),
    systemRole: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    title: z.string().nullish(),
    virtual: z.boolean().nullish(),
  })
  .partial();

const agentGroupProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentGroupRepo: new AgentGroupRepository(ctx.serverDB, ctx.userId, wsId),
      agentGroupService: new AgentGroupService(ctx.serverDB, ctx.userId, wsId),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      chatGroupModel: new ChatGroupModel(ctx.serverDB, ctx.userId, wsId),
      editLockService: new EditLockService(ctx.userId),
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

// Write variant gates viewers out of chat-group mutations (create/update/
// delete + member adds/removes). Reads keep the bare proc.
const agentGroupProcedureWrite = agentGroupProcedure.use(withScopedPermission('agent:update'));

export const agentGroupRouter = router({
  addAgentsToGroup: agentGroupProcedureWrite
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
  batchCreateAgentsInGroup: agentGroupProcedureWrite
    .input(
      z.object({
        agents: z.array(agentMemberInputSchema),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
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
  createGroup: agentGroupProcedureWrite
    .input(InsertChatGroupSchema)
    .mutation(async ({ input, ctx }) => {
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
      // 1. Batch create virtual member agents
      const memberConfigs = input.members.map((member) => ({
        ...member,
        // See the `batchCreateAgentsInGroup` cast above for why this bridges
        // to `string[]` instead of failing type-check.
        plugins: member.plugins as unknown as string[] | undefined,
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

  deleteGroup: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentGroupService.deleteGroup(input.id);
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
  removeAgentsFromGroup: agentGroupProcedureWrite
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

  transferGroup: agentGroupProcedureWrite
    .input(
      z.object({
        groupId: z.string(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const group = await ctx.chatGroupModel.findById(input.groupId);
      if (!group) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Agent group not found',
        });
      }

      if (ctx.workspaceId && group.userId !== ctx.userId) {
        const canOverride = await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          scopes: ['ALL'],
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        if (!canOverride) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: 'Only workspace owners can transfer agent groups created by others',
          });
        }
      }

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'AGENT_CREATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });

        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      if (input.targetWorkspaceId === ctx.workspaceId) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer agent group to the same workspace',
        });
      }

      return ctx.agentGroupRepo.transferToWorkspace(
        input.groupId,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),

  updateAgentInGroup: agentGroupProcedureWrite
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

  /**
   * Publish a private chat group into the workspace. One-way: once shared,
   * other workspace members may already be using it, so we never let it slip
   * back to `private`. Restricted to the creator's own still-private group.
   */
  publishGroupToWorkspace: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.chatGroupModel.publishToWorkspace(input.id);
    }),

  updateGroup: agentGroupProcedureWrite
    .input(
      z.object({
        id: z.string(),
        value: InsertChatGroupSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
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

  acquireGroupLock: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const prev = await ctx.editLockService.getActiveHolder('chatGroup', input.id);
      const result = await ctx.editLockService.acquire('chatGroup', input.id);
      if ((result.holderId ?? null) !== (prev ?? null)) {
        void publishResourceEvent(
          { id: input.id, type: 'chatGroup' },
          { actorId: ctx.userId, data: { holderId: result.holderId }, type: 'lock.changed' },
        );
      }
      return result;
    }),

  getGroupLock: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const holder = await ctx.editLockService.getActiveHolder('chatGroup', input.id);
      return {
        expiresAt: null,
        holderId: holder ?? null,
        lockedByOther: Boolean(holder) && holder !== ctx.userId,
      };
    }),

  releaseGroupLock: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return;
      // Only broadcast "unlocked" when we actually released our own lock — if the
      // lease expired and another member took over, the lock is still held.
      const released = await ctx.editLockService.release('chatGroup', input.id);
      if (!released) return;
      void publishResourceEvent(
        { id: input.id, type: 'chatGroup' },
        { actorId: ctx.userId, data: { holderId: null }, type: 'lock.changed' },
      );
    }),
});

export type AgentGroupRouter = typeof agentGroupRouter;

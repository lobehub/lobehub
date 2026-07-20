import { AgentPluginEntrySchema, InsertChatGroupSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { UserModel } from '@/database/models/user';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { DEFAULT_RESOURCE_ACCESS_LEVELS, RESOURCE_ACCESS_LEVELS_BY_TYPE } from '@/database/schemas';
import { type ChatGroupConfig } from '@/database/types/chatGroup';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentGroupService } from '@/server/services/agentGroup';
import { EditLockService } from '@/server/services/editLock';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
  buildResourcePermissionState,
} from '@/server/services/resourcePermission';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { isWorkspaceNonOwner } from './_helpers/assertWorkspaceRowManageable';
import {
  getResourceConfigAccess,
  redactAgentConfig,
  redactGroupConfig,
  type ResourceConfigAccess,
} from './_helpers/resourceConfigGuard';

const resourceConfigGuardCtx = (ctx: {
  serverDB: Parameters<typeof getResourceConfigAccess>[0]['db'];
  userId: string;
  workspaceId?: string | null;
  workspacePermissionCodes?: string[];
}) => ({
  db: ctx.serverDB,
  grantedPermissions: ctx.workspacePermissionCodes,
  userId: ctx.userId,
  workspaceId: ctx.workspaceId,
});

const getGroupConfigAccess = <T extends Record<string, any>>(
  ctx: {
    serverDB: Parameters<typeof getResourceConfigAccess>[0]['db'];
    userId: string;
    workspaceId?: string | null;
    workspacePermissionCodes?: string[];
  },
  group: T,
): Promise<ResourceConfigAccess> =>
  getResourceConfigAccess(resourceConfigGuardCtx(ctx), 'agentGroup', group.id, {
    userId: group.userId,
    visibility: group.visibility ?? null,
    workspaceId: group.workspaceId ?? null,
  });

const protectGroupMemberConfigs = async <T extends Record<string, any>>(
  ctx: Parameters<typeof resourceConfigGuardCtx>[0],
  group: T,
): Promise<T> => {
  if (!Array.isArray(group.agents) || group.agents.length === 0) return group;

  let changed = false;
  const protectedAgents = await Promise.all(
    group.agents.map(async (agent: Record<string, any>) => {
      const knownMeta =
        agent.userId && agent.workspaceId !== undefined
          ? {
              userId: agent.userId,
              visibility: agent.visibility ?? null,
              workspaceId: agent.workspaceId ?? null,
            }
          : undefined;
      const access = await getResourceConfigAccess(
        resourceConfigGuardCtx(ctx),
        'agent',
        agent.id,
        knownMeta,
      );

      if (access === 'none') {
        changed = true;
        return null;
      }
      if (access === 'profile') {
        changed = true;
        return redactAgentConfig(agent);
      }
      return agent;
    }),
  );

  return changed ? ({ ...group, agents: protectedAgents.filter(Boolean) } as T) : group;
};

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
          ...createdAgents
            .filter((agent) => agent.visibility !== 'private')
            .map((agent) =>
              permissionModel.setAccessLevel(
                'agent',
                agent.id,
                DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
                ctx.userId,
              ),
            ),
        ]);
      }

      return { agentIds: memberAgentIds, groupId: group.id, supervisorAgentId };
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
      }
      return result;
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

  getGroup: agentGroupProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const group = await ctx.chatGroupModel.findById(input.id);
      if (!group) return group;
      const access = await getGroupConfigAccess(ctx, group);
      if (access === 'none') return undefined;
      return access === 'profile' ? redactGroupConfig(group) : group;
    }),

  getGroupAgents: agentGroupProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.groupId,
        resourceType: 'agentGroup',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

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
      const detail = await ctx.agentGroupService.getGroupDetail(input.id);
      if (!detail) return null;
      const access = await getGroupConfigAccess(ctx, detail);
      if (access === 'none') return null;
      if (access === 'profile') return redactGroupConfig(detail);

      const defaultAgentConfig = await ctx.userModel.getUserSettingsDefaultAgentConfig();
      return protectGroupMemberConfigs(ctx, {
        ...detail,
        agents: ctx.agentGroupService.mergeAgentsDefaultConfig(defaultAgentConfig, detail.agents),
      });
    }),

  getGroups: agentGroupProcedure.query(async ({ ctx }) => {
    const groups = await ctx.agentGroupService.getGroups();
    const accessLevels = await Promise.all(groups.map((group) => getGroupConfigAccess(ctx, group)));
    const hasFullConfig = accessLevels.includes('full');
    const defaultAgentConfig = hasFullConfig
      ? await ctx.userModel.getUserSettingsDefaultAgentConfig()
      : undefined;

    const protectedGroups = await Promise.all(
      groups.map(async (group, index) => {
        const access = accessLevels[index];
        if (access === 'none') return null;
        if (access === 'profile') return redactGroupConfig(group);
        if (!defaultAgentConfig) return group;

        return protectGroupMemberConfigs(ctx, {
          ...group,
          agents: ctx.agentGroupService.mergeAgentsDefaultConfig(defaultAgentConfig, group.agents),
        });
      }),
    );

    return protectedGroups.filter((group): group is NonNullable<typeof group> => Boolean(group));
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
        targetAccessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agentGroup).optional(),
        /** @deprecated Compatibility for released clients. */
        targetGeneralAccess: z.enum(['editor', 'viewer']).optional(),
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

      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'transfer',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
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

      // The transfer rehomes member agents and every group conversation — a
      // non-owner member must not move teammates' rows along with their group.
      if (
        isWorkspaceNonOwner(ctx) &&
        (await ctx.agentGroupRepo.transferHasForeignRows(input.groupId))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only workspace owners can transfer a group carrying others' content",
        });
      }

      const result = await ctx.agentGroupRepo.transferToWorkspace(
        input.groupId,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );

      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'agentGroup',
          input.groupId,
        );
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        const targetAccessLevel =
          input.targetAccessLevel ??
          (input.targetGeneralAccess === 'editor'
            ? 'edit'
            : DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup);
        await new ResourcePermissionModel(ctx.serverDB, input.targetWorkspaceId).setAccessLevel(
          'agentGroup',
          input.groupId,
          targetAccessLevel,
          ctx.userId,
        );
      }

      return result;
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

  /**
   * Publish a private chat group into the workspace. One-way: once shared,
   * other workspace members may already be using it, so we never let it slip
   * back to `private`. Restricted to the creator's own still-private group.
   */
  publishGroupToWorkspace: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.chatGroupModel.publishToWorkspace(input.id);
      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'agentGroup',
          input.id,
          DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup,
          ctx.userId,
        );
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

      const accessLevel =
        input.visibility === 'private'
          ? 'edit'
          : (input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup);
      if (input.visibility === 'private') {
        await permissionModel.removeAll('agentGroup', input.id);
      } else {
        await permissionModel.setAccessLevel(
          'agentGroup',
          input.id,
          input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup,
          ctx.userId,
        );
      }

      return buildResourcePermissionState({
        accessLevel,
        canManage: true,
        creatorId: group.userId,
        visibility: input.visibility,
      });
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

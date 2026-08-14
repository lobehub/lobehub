/**
 * Group Agent Builder Server Runtime — server-side group configuration.
 *
 * The client counterpart (`packages/builtin-tool-group-agent-builder/src/ExecutionRuntime`)
 * drives zustand stores and only runs under the legacy client runtime. Cloud runs
 * gateway mode, where every builtin tool executes here, so without this runtime
 * `toolExecution/builtin.ts` throws `Builtin tool "lobe-group-agent-builder" is
 * not implemented` and *every* member/config mutation fails — the model then
 * falls back to generic agent creation, which spawns standalone agents outside
 * the group (LOBE-12941).
 *
 * The edited group rides on `ctx.editingGroupId` (see `ExecAgentAppContext`),
 * NOT `ctx.groupId`: the builder conversation is owned by the builtin builder
 * agent and must not be stamped as a group-chat turn.
 *
 * Member creation mirrors `routers/lambda/agentGroup.ts` exactly — virtual
 * agents, roster insert, and workspace access-level inheritance — so an agent
 * created by the assistant is indistinguishable from one created through the UI.
 */
import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
} from '@lobechat/builtin-tool-agent-builder';
import type {
  BatchCreateAgentsParams,
  BatchCreateAgentsState,
  CreateAgentParams,
  CreateAgentState,
  CreateGroupParams,
  CreateGroupState,
  GetAgentInfoParams,
  InviteAgentParams,
  InviteAgentState,
  RemoveAgentParams,
  RemoveAgentState,
  SearchAgentParams,
  SearchAgentState,
  UpdateAgentConfigWithIdParams,
  UpdateAgentPromptParams,
  UpdateAgentPromptState,
  UpdateGroupParams,
  UpdateGroupPromptParams,
  UpdateGroupPromptState,
  UpdateGroupState,
} from '@lobechat/builtin-tool-group-agent-builder';
import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { formatAgentProfile } from '@lobechat/prompts';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import type { ChatGroupConfig } from '@/database/types/chatGroup';
import { AgentGroupService } from '@/server/services/agentGroup';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

import { type ToolExecutionContext, type ToolExecutionResult } from '../types';
import { agentBuilderRuntime } from './agentBuilder';
import { type ServerRuntimeRegistration } from './types';

const handleError = (error: unknown, message: string): ToolExecutionResult => {
  const err = error as Error;
  return { content: `${message}: ${err.message}`, success: false };
};

const noGroupContext = (): ToolExecutionResult => ({
  content: 'No active group found',
  error: { message: 'No active group found', type: 'NoGroupContext' },
  success: false,
});

const groupNotFound = (groupId: string): ToolExecutionResult => ({
  content: `Group "${groupId}" not found`,
  error: { message: `Group "${groupId}" not found`, type: 'GroupNotFound' },
  success: false,
});

export const groupAgentBuilderRuntime: ServerRuntimeRegistration = {
  factory: (context: ToolExecutionContext) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Group Agent Builder execution');
    }
    const { serverDB, userId } = context;
    const workspaceId = context.workspaceId ?? undefined;

    const agentModel = new AgentModel(serverDB, userId, workspaceId);
    const chatGroupModel = new ChatGroupModel(serverDB, userId, workspaceId);
    const agentGroupRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
    const agentGroupService = new AgentGroupService(serverDB, userId, workspaceId);

    // The edited group is carried by `editingGroupId`; `groupId` is kept as a
    // fallback for callers that legitimately run inside a group chat turn.
    const resolveGroupId = (ctx: ToolExecutionContext, override?: string) =>
      override ?? ctx.editingGroupId ?? ctx.groupId ?? undefined;

    /**
     * Mutating a group's roster or config is a group edit — same ACL as the
     * `agentGroup` router. Runs before any write so a denied call never leaves
     * a half-created agent behind.
     */
    const assertGroupEditable = async (groupId: string) => {
      if (!workspaceId) return;
      await assertCanPerformResourceAction({
        action: 'edit',
        db: serverDB,
        resourceId: groupId,
        resourceType: 'agentGroup',
        userId,
        workspaceId,
      });
    };

    /**
     * Group-owned members inherit the group's current General Access so a group
     * already opened to `edit` doesn't spawn `use`-locked members. Mirrors
     * `agentGroup.batchCreateAgentsInGroup`.
     */
    const inheritGroupAccessLevel = async (
      groupId: string,
      createdAgents: Array<{ id: string; visibility?: string | null }>,
    ) => {
      if (!workspaceId) return;
      const permissionModel = new ResourcePermissionModel(serverDB, workspaceId);
      const groupLevel = await permissionModel.getAccessLevel('agentGroup', groupId);
      await Promise.all(
        createdAgents
          .filter((agent) => agent.visibility !== 'private')
          .map((agent) =>
            permissionModel.setAccessLevel(
              'agent',
              agent.id,
              groupLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
              userId,
            ),
          ),
      );
    };

    const findSupervisorAgentId = async (groupId: string) => {
      const roster = await chatGroupModel.getGroupAgentsWithMeta(groupId);
      return roster.find((member) => member.role === 'supervisor')?.agentId;
    };

    /** Delegate to the AgentBuilder runtime with the target agent pinned. */
    const withEditingAgent = (
      ctx: ToolExecutionContext,
      agentId: string,
    ): ToolExecutionContext => ({
      ...ctx,
      editingAgentId: agentId,
    });

    const builder = agentBuilderRuntime.factory(context);

    return {
      // ==================== Agent Info ====================

      getAgentInfo: async (
        params: GetAgentInfoParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        if (!groupId) return noGroupContext();

        try {
          const roster = await chatGroupModel.getGroupAgentsWithMeta(groupId);
          const member = roster.find((item) => item.agentId === params.agentId);

          if (!member) {
            return {
              content: `Agent "${params.agentId}" not found in this group`,
              error: { message: `Agent "${params.agentId}" not found`, type: 'AgentNotFound' },
              success: false,
            };
          }

          const config = await agentModel.getAgentConfigById(params.agentId);
          const agent = {
            description: member.description ?? undefined,
            id: params.agentId,
            model: config?.model ?? undefined,
            systemRole: config?.systemRole ?? undefined,
            title: member.title ?? undefined,
          };

          return { content: formatAgentProfile(agent), state: agent, success: true };
        } catch (error) {
          return handleError(error, 'Failed to get agent info');
        }
      },

      // ==================== Group Member Management ====================

      searchAgent: async (params: SearchAgentParams): Promise<ToolExecutionResult> => {
        const { query, limit = 10 } = params;

        try {
          const results = await agentModel.queryAgents({ keyword: query, limit });
          const agents = results.map((agent) => ({
            avatar: agent.avatar ?? undefined,
            description: agent.description ?? undefined,
            id: agent.id,
            title: agent.title ?? '',
          }));

          if (agents.length === 0) {
            return {
              content: query
                ? `No agents found matching "${query}".`
                : 'No agents found. You can create a new agent or search with different keywords.',
              state: { agents: [], query, total: 0 } satisfies SearchAgentState,
              success: true,
            };
          }

          const agentList = agents
            .map(
              (a, i) =>
                `${i + 1}. ${a.title || 'Untitled'} (ID: ${a.id})${a.description ? ` - ${a.description}` : ''}`,
            )
            .join('\n');

          return {
            content: query
              ? `Found ${agents.length} agent${agents.length > 1 ? 's' : ''} matching "${query}":\n${agentList}`
              : `Found ${agents.length} agent${agents.length > 1 ? 's' : ''}:\n${agentList}`,
            state: { agents, query, total: agents.length } satisfies SearchAgentState,
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to search agents');
        }
      },

      createGroup: async (params: CreateGroupParams): Promise<ToolExecutionResult> => {
        try {
          const groupConfig: ChatGroupConfig = {
            ...(params.openingMessage !== undefined && { openingMessage: params.openingMessage }),
            ...(params.openingQuestions !== undefined && {
              openingQuestions: params.openingQuestions,
            }),
          } as ChatGroupConfig;

          const { group, supervisorAgentId } = await agentGroupRepo.createGroupWithSupervisor(
            {
              avatar: params.avatar,
              backgroundColor: params.backgroundColor,
              config: agentGroupService.normalizeGroupConfig(
                Object.keys(groupConfig).length > 0 ? groupConfig : null,
              ),
              content: params.prompt,
              description: params.description,
              title: params.title,
            },
            [],
            params.supervisor
              ? {
                  avatar: params.supervisor.avatar,
                  backgroundColor: params.supervisor.backgroundColor,
                  description: params.supervisor.description,
                  model: params.supervisor.model,
                  params: params.supervisor.params,
                  provider: params.supervisor.provider,
                  systemRole: params.supervisor.systemRole,
                  tags: params.supervisor.tags,
                  title: params.supervisor.title,
                }
              : undefined,
          );

          if (workspaceId && group.visibility !== 'private') {
            const permissionModel = new ResourcePermissionModel(serverDB, workspaceId);
            await Promise.all([
              permissionModel.setAccessLevel(
                'agentGroup',
                group.id,
                DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup,
                userId,
              ),
              permissionModel.setAccessLevel(
                'agent',
                supervisorAgentId,
                DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
                userId,
              ),
            ]);
          }

          return {
            content: `Successfully created group "${params.title}" with ID: ${group.id}`,
            state: {
              groupId: group.id,
              success: true,
              supervisorAgentId,
              title: params.title,
            } satisfies CreateGroupState,
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to create group');
        }
      },

      createAgent: async (
        params: CreateAgentParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        if (!groupId) return noGroupContext();

        try {
          const group = await chatGroupModel.findById(groupId);
          if (!group) return groupNotFound(groupId);

          await assertGroupEditable(groupId);

          const [agent] = await agentModel.batchCreate([
            {
              avatar: params.avatar,
              description: params.description,
              // Domain tool plugins support structured entries, while the DB
              // model's JSONB column still carries its legacy string[] type.
              plugins: params.tools as unknown as string[] | undefined,
              systemRole: params.systemRole,
              title: params.title,
              virtual: true,
              ...(group.visibility ? { visibility: group.visibility } : {}),
            },
          ]);

          await chatGroupModel.addAgentsToGroup(groupId, [agent.id]);
          await inheritGroupAccessLevel(groupId, [agent]);

          return {
            content: `Successfully created agent "${params.title}" and added it to the group.`,
            state: {
              agentId: agent.id,
              success: true,
              title: params.title,
            } satisfies CreateAgentState,
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to create agent');
        }
      },

      batchCreateAgents: async (
        params: BatchCreateAgentsParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        if (!groupId) return noGroupContext();

        try {
          const group = await chatGroupModel.findById(groupId);
          if (!group) return groupNotFound(groupId);

          await assertGroupEditable(groupId);

          const createdAgents = await agentModel.batchCreate(
            params.agents.map((agent) => ({
              avatar: agent.avatar,
              description: agent.description,
              plugins: agent.tools as unknown as string[] | undefined,
              systemRole: agent.systemRole,
              title: agent.title,
              virtual: true,
              ...(group.visibility ? { visibility: group.visibility } : {}),
            })),
          );

          await chatGroupModel.addAgentsToGroup(
            groupId,
            createdAgents.map((agent) => agent.id),
          );
          await inheritGroupAccessLevel(groupId, createdAgents);

          const results = createdAgents.map((agent, index) => ({
            agentId: agent.id,
            success: true,
            title: params.agents[index].title,
          }));
          const createdList = results.map((r) => `- ${r.title} (ID: ${r.agentId})`).join('\n');

          return {
            content: `Successfully created ${results.length} agent${results.length > 1 ? 's' : ''}:\n${createdList}`,
            state: {
              agents: results,
              failedCount: 0,
              successCount: results.length,
            } satisfies BatchCreateAgentsState,
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to create agents');
        }
      },

      inviteAgent: async (
        params: InviteAgentParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        if (!groupId) return noGroupContext();

        try {
          const group = await chatGroupModel.findById(groupId);
          if (!group) return groupNotFound(groupId);

          await assertGroupEditable(groupId);

          const roster = await chatGroupModel.getGroupAgentsWithMeta(groupId);
          const existing = roster.find((member) => member.agentId === params.agentId);

          if (existing) {
            return {
              content: `Agent ${existing.title || params.agentId} is already in the group`,
              state: {
                agentId: params.agentId,
                agentName: existing.title ?? undefined,
                success: false,
              } satisfies InviteAgentState,
              success: false,
            };
          }

          const result = await chatGroupModel.addAgentsToGroup(groupId, [params.agentId]);
          const wasAdded = result.added.length > 0;

          const agentMeta = await agentModel.getAgentConfigById(params.agentId);
          const agentName = agentMeta?.title ?? undefined;
          const agentDisplay = agentName ? `${agentName} (ID: ${params.agentId})` : params.agentId;

          return {
            content: wasAdded
              ? `Successfully invited agent ${agentDisplay} to the group`
              : `Agent ${agentDisplay} was already in the group`,
            state: {
              agentAvatar: agentMeta?.avatar ?? undefined,
              agentId: params.agentId,
              agentName,
              success: wasAdded,
            } satisfies InviteAgentState,
            success: wasAdded,
          };
        } catch (error) {
          return handleError(error, 'Failed to invite agent');
        }
      },

      removeAgent: async (
        params: RemoveAgentParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        if (!groupId) return noGroupContext();

        try {
          const group = await chatGroupModel.findById(groupId);
          if (!group) return groupNotFound(groupId);

          await assertGroupEditable(groupId);

          const roster = await chatGroupModel.getGroupAgentsWithMeta(groupId);
          const member = roster.find((item) => item.agentId === params.agentId);

          if (!member) {
            return {
              content: `Agent ${params.agentId} is not in the group`,
              state: { agentId: params.agentId, success: false } satisfies RemoveAgentState,
              success: false,
            };
          }

          const agentName = member.title ?? undefined;
          const agentDisplay = agentName ? `${agentName} (ID: ${params.agentId})` : params.agentId;

          // The supervisor is the group's orchestrator — removing it would leave
          // the group unable to dispatch. Same guard as the client runtime.
          if (member.role === 'supervisor') {
            return {
              content: `Cannot remove supervisor agent ${agentDisplay} from the group`,
              state: {
                agentId: params.agentId,
                agentName,
                success: false,
              } satisfies RemoveAgentState,
              success: false,
            };
          }

          await chatGroupModel.removeAgentsFromGroup(groupId, [params.agentId]);

          return {
            content: `Successfully removed agent ${agentDisplay} from the group`,
            state: {
              agentId: params.agentId,
              agentName,
              success: true,
            } satisfies RemoveAgentState,
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to remove agent');
        }
      },

      // ==================== Group Configuration ====================

      updateAgentPrompt: async (
        params: UpdateAgentPromptParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        if (!groupId) return noGroupContext();

        try {
          await assertGroupEditable(groupId);

          const roster = await chatGroupModel.getGroupAgentsWithMeta(groupId);
          if (!roster.some((member) => member.agentId === params.agentId)) {
            return {
              content: `Agent "${params.agentId}" is not a member of this group`,
              error: { message: `Agent "${params.agentId}" not found`, type: 'AgentNotFound' },
              success: false,
            };
          }

          const previous = await agentModel.getAgentConfigById(params.agentId);

          // Clear `editorData` alongside `systemRole`: the profile editor treats
          // the JSON doc as authoritative, so leaving it stale would revert the
          // markdown on the next autosave (same rule as AgentBuilder.updatePrompt).
          await agentModel.update(params.agentId, {
            editorData: null,
            systemRole: params.prompt,
          } as Record<string, unknown>);

          return {
            content: params.prompt
              ? `Successfully updated agent ${params.agentId} system prompt (${params.prompt.length} characters)`
              : `Successfully cleared agent ${params.agentId} system prompt`,
            state: {
              agentId: params.agentId,
              newPrompt: params.prompt,
              previousPrompt: previous?.systemRole ?? undefined,
              success: true,
            } satisfies UpdateAgentPromptState,
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to update agent prompt');
        }
      },

      updateGroup: async (
        params: UpdateGroupParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx, params.groupId);
        if (!groupId) return noGroupContext();

        const { config, meta } = params;
        if (!config && !meta) {
          return {
            content: 'No configuration or metadata provided',
            error: { message: 'No configuration or metadata provided', type: 'NoDataProvided' },
            success: false,
          };
        }

        try {
          const group = await chatGroupModel.findById(groupId);
          if (!group) return groupNotFound(groupId);

          await assertGroupEditable(groupId);

          const updatedFields: string[] = [];
          const state: UpdateGroupState = { success: true };
          const patch: Record<string, unknown> = {};

          if (config) {
            const configUpdate: { openingMessage?: string; openingQuestions?: string[] } = {};

            if (config.openingMessage !== undefined) {
              configUpdate.openingMessage = config.openingMessage;
              updatedFields.push(
                config.openingMessage
                  ? `openingMessage (${config.openingMessage.length} chars)`
                  : 'openingMessage (cleared)',
              );
            }
            if (config.openingQuestions !== undefined) {
              configUpdate.openingQuestions = config.openingQuestions;
              updatedFields.push(
                config.openingQuestions.length > 0
                  ? `openingQuestions (${config.openingQuestions.length} questions)`
                  : 'openingQuestions (cleared)',
              );
            }

            if (Object.keys(configUpdate).length > 0) {
              patch.config = { ...group.config, ...configUpdate };
              state.updatedConfig = configUpdate;
            }
          }

          if (meta && Object.keys(meta).length > 0) {
            Object.assign(patch, meta);
            state.updatedMeta = meta;

            if (meta.avatar !== undefined)
              updatedFields.push(`avatar (${meta.avatar || 'cleared'})`);
            if (meta.title !== undefined) updatedFields.push(`title (${meta.title || 'cleared'})`);
            if (meta.description !== undefined) {
              updatedFields.push(
                meta.description
                  ? `description (${meta.description.length} chars)`
                  : 'description (cleared)',
              );
            }
            if (meta.backgroundColor !== undefined) {
              updatedFields.push(`backgroundColor (${meta.backgroundColor || 'cleared'})`);
            }
          }

          if (Object.keys(patch).length > 0) await chatGroupModel.update(groupId, patch);

          return {
            content: `Successfully updated group: ${updatedFields.join(', ')}`,
            state,
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to update group');
        }
      },

      updateGroupPrompt: async (
        params: UpdateGroupPromptParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx, params.groupId);
        if (!groupId) return noGroupContext();

        try {
          const group = await chatGroupModel.findById(groupId);
          if (!group) return groupNotFound(groupId);

          await assertGroupEditable(groupId);

          // `editorData` mirrors `content` for the profile editor; clear it so a
          // stale JSON doc doesn't overwrite the new markdown on next autosave.
          await chatGroupModel.update(groupId, { content: params.prompt, editorData: null });

          return {
            content: params.prompt
              ? `Successfully updated group shared prompt (${params.prompt.length} characters)`
              : 'Successfully cleared group shared prompt',
            state: {
              newPrompt: params.prompt,
              previousPrompt: group.content ?? undefined,
              success: true,
            } satisfies UpdateGroupPromptState,
            success: true,
          };
        } catch (error) {
          return {
            ...handleError(error, 'Failed to update group prompt'),
            state: { newPrompt: params.prompt, success: false } satisfies UpdateGroupPromptState,
          };
        }
      },

      // ============ Inherited from AgentBuilder (supervisor / member agent) ============

      getAvailableModels: (params: GetAvailableModelsParams): Promise<ToolExecutionResult> =>
        builder.getAvailableModels(params),

      searchMarketTools: (params: SearchMarketToolsParams): Promise<ToolExecutionResult> =>
        builder.searchMarketTools(params),

      updateConfig: async (
        params: UpdateAgentConfigWithIdParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        const { agentId: paramAgentId, ...rest } = params;

        // A caller-supplied id has to be confirmed against this group's roster
        // first. The delegated `AgentBuilder.updateConfig` write is scoped by
        // visibility alone, so without this check a tool call naming any agent
        // the caller can merely *see* would reconfigure it from inside a group
        // edit. The supervisor fallback below needs no check — it is read off
        // the roster itself. (The tool contract documents `agentId` as optional
        // and "defaults to the supervisor agent".)
        if (paramAgentId) {
          if (!groupId) return noGroupContext();

          const roster = await chatGroupModel.getGroupAgentsWithMeta(groupId);
          if (!roster.some((member) => member.agentId === paramAgentId)) {
            return {
              content: `Agent "${paramAgentId}" is not a member of this group`,
              error: { message: `Agent "${paramAgentId}" not found`, type: 'AgentNotFound' },
              success: false,
            };
          }
        }

        const agentId =
          paramAgentId ?? (groupId ? await findSupervisorAgentId(groupId) : undefined);

        if (!agentId) {
          return {
            content:
              'No agent found. Please provide an agentId or ensure supervisor context is available.',
            error: { message: 'No agent found', type: 'NoAgentContext' },
            success: false,
          };
        }

        if (groupId) await assertGroupEditable(groupId);

        return builder.updateConfig(rest, withEditingAgent(ctx, agentId));
      },

      installPlugin: async (
        params: InstallPluginParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const groupId = resolveGroupId(ctx);
        const agentId = groupId ? await findSupervisorAgentId(groupId) : undefined;

        if (!agentId) {
          return {
            content: 'No supervisor agent found',
            error: { message: 'No supervisor agent found', type: 'NoAgentContext' },
            success: false,
          };
        }

        if (groupId) await assertGroupEditable(groupId);

        return builder.installPlugin(params, withEditingAgent(ctx, agentId));
      },
    };
  },
  identifier: GroupAgentBuilderIdentifier,
};

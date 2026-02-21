import { formatAgentProfile } from '@lobechat/prompts';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { agentService } from '@/services/agent';
import type { GroupMemberConfig } from '@/services/chatGroup';
import { chatGroupService } from '@/services/chatGroup';
import { useAgentStore } from '@/store/agent';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

import type {
  BatchCreateAgentsParams,
  BatchCreateAgentsState,
  CreateAgentParams,
  CreateAgentState,
  GetAgentInfoParams,
  InviteAgentParams,
  InviteAgentState,
  RemoveAgentParams,
  RemoveAgentState,
  SearchAgentParams,
  SearchAgentState,
  UpdateAgentPromptParams,
  UpdateGroupParams,
  UpdateGroupPromptParams,
  UpdateGroupPromptState,
  UpdateGroupState,
} from '../types';

/**
 * Group Agent Builder Execution Runtime
 * Handles the execution logic for Group Agent Builder APIs
 * Extends AgentBuilder functionality with group-specific operations
 */
export class GroupAgentBuilderExecutionRuntime {
  // ==================== Agent Info ====================

  /**
   * Get detailed information about a specific agent
   */
  async getAgentInfo(
    groupId: string | undefined,
    args: GetAgentInfoParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!groupId) {
      return {
        content: 'No group context available',
        success: false,
      };
    }

    const state = getChatGroupStoreState();
    const agent = agentGroupSelectors.getAgentByIdFromGroup(groupId, args.agentId)(state);

    if (!agent) {
      return { content: `Agent "${args.agentId}" not found in this group`, success: false };
    }

    // Return formatted agent profile for the supervisor
    return { content: formatAgentProfile(agent), state: agent, success: true };
  }

  // ==================== Group Member Management ====================

  /**
   * Search for agents that can be invited to the group
   */
  async searchAgent(args: SearchAgentParams): Promise<BuiltinServerRuntimeOutput> {
    const { query, limit = 10 } = args;

    try {
      const results = await agentService.queryAgents({ keyword: query, limit });

      const agents = results.map((agent) => ({
        avatar: agent.avatar,
        description: agent.description,
        id: agent.id,
        title: agent.title,
      }));

      const total = agents.length;

      if (total === 0) {
        return {
          content: query
            ? `No agents found matching "${query}".`
            : 'No agents found. You can create a new agent or search with different keywords.',
          state: { agents: [], query, total: 0 } as SearchAgentState,
          success: true,
        };
      }

      // Format agents list for LLM consumption
      const agentList = agents
        .map(
          (a, i) =>
            `${i + 1}. ${a.title || 'Untitled'} (ID: ${a.id})${a.description ? ` - ${a.description}` : ''}`,
        )
        .join('\n');

      return {
        content: query
          ? `Found ${total} agent${total > 1 ? 's' : ''} matching "${query}":\n${agentList}`
          : `Found ${total} agent${total > 1 ? 's' : ''}:\n${agentList}`,
        state: { agents, query, total } as SearchAgentState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to search agents: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Create a new agent and add it to the group
   */
  async createAgent(groupId: string, args: CreateAgentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getChatGroupStoreState();
      const group = agentGroupSelectors.getGroupById(groupId)(state);

      if (!group) {
        return {
          content: 'Group not found',
          error: 'Group not found',
          success: false,
        };
      }

      // Create a virtual agent only (no session needed for group agents)
      // Map 'tools' from LLM input to 'plugins' for internal API
      const result = await agentService.createAgentOnly({
        config: {
          avatar: args.avatar,
          description: args.description,
          plugins: args.tools,
          systemRole: args.systemRole,
          title: args.title,
          virtual: true,
        },
        groupId,
      });

      if (!result.agentId) {
        return {
          content: 'Failed to create agent: No agent ID returned',
          success: false,
        };
      }

      // Refresh the group detail in the store
      await state.refreshGroupDetail(groupId);

      return {
        content: `Successfully created agent "${args.title}" and added it to the group.`,
        state: {
          agentId: result.agentId,
          success: true,
          title: args.title,
        } as CreateAgentState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to create agent: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Create multiple agents at once and add them to the group
   * Uses batch API for efficiency (single request instead of N requests)
   */
  async batchCreateAgents(
    groupId: string,
    args: BatchCreateAgentsParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getChatGroupStoreState();
      const group = agentGroupSelectors.getGroupById(groupId)(state);

      if (!group) {
        return {
          content: 'Group not found',
          error: 'Group not found',
          success: false,
        };
      }

      // Use batch API to create all agents in one request
      // Map 'tools' from LLM input to 'plugins' for internal API
      const agentConfigs: GroupMemberConfig[] = args.agents.map((agentDef) => ({
        avatar: agentDef.avatar,
        description: agentDef.description,
        plugins: agentDef.tools,
        systemRole: agentDef.systemRole,
        title: agentDef.title,
      }));

      const { agents: createdAgents } = await chatGroupService.batchCreateAgentsInGroup(
        groupId,
        agentConfigs,
      );

      // Refresh the group detail in the store
      await state.refreshGroupDetail(groupId);

      const results = createdAgents.map((agent, index) => ({
        agentId: agent.id,
        success: true,
        title: args.agents[index].title,
      }));

      const createdList = results.map((r) => `- ${r.title} (ID: ${r.agentId})`).join('\n');

      return {
        content: `Successfully created ${results.length} agent${results.length > 1 ? 's' : ''}:\n${createdList}`,
        state: {
          agents: results,
          failedCount: 0,
          successCount: results.length,
        } as BatchCreateAgentsState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to create agents: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Invite an agent to the group
   */
  async inviteAgent(groupId: string, args: InviteAgentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getChatGroupStoreState();
      const group = agentGroupSelectors.getGroupById(groupId)(state);

      if (!group) {
        return {
          content: 'Group not found',
          error: 'Group not found',
          success: false,
        };
      }

      // Check if agent is already in the group
      const existingAgents = group.agents || [];
      const existingAgent = existingAgents.find((a) => a.id === args.agentId);

      if (existingAgent) {
        return {
          content: `Agent ${existingAgent.title || args.agentId} is already in the group`,
          state: {
            agentAvatar: existingAgent.avatar,
            agentId: args.agentId,
            agentName: existingAgent.title,
            success: false,
          } as InviteAgentState,
          success: false,
        };
      }

      // Add the agent to the group via service
      const result = await chatGroupService.addAgentsToGroup(groupId, [args.agentId]);

      // Refresh the group detail in the store
      await state.refreshGroupDetail(groupId);

      const wasAdded = result.added.length > 0;

      // Get the agent info from the updated group
      const updatedGroup = agentGroupSelectors.getGroupById(groupId)(getChatGroupStoreState());
      const addedAgent = updatedGroup?.agents?.find((a) => a.id === args.agentId);
      const agentName = addedAgent?.title;
      const agentAvatar = addedAgent?.avatar;

      const agentDisplay = agentName ? `${agentName} (ID: ${args.agentId})` : args.agentId;

      return {
        content: wasAdded
          ? `Successfully invited agent ${agentDisplay} to the group`
          : `Agent ${agentDisplay} was already in the group`,
        state: {
          agentAvatar,
          agentId: args.agentId,
          agentName,
          success: wasAdded,
        } as InviteAgentState,
        success: wasAdded,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to invite agent: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Remove an agent from the group
   */
  async removeAgent(groupId: string, args: RemoveAgentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getChatGroupStoreState();
      const group = agentGroupSelectors.getGroupById(groupId)(state);

      if (!group) {
        return {
          content: 'Group not found',
          error: 'Group not found',
          success: false,
        };
      }

      // Check if agent is in the group
      const existingAgents = group.agents || [];
      const agent = existingAgents.find((a) => a.id === args.agentId);

      if (!agent) {
        return {
          content: `Agent ${args.agentId} is not in the group`,
          state: {
            agentId: args.agentId,
            success: false,
          } as RemoveAgentState,
          success: false,
        };
      }

      // Get agent info before removing
      const agentName = agent.title;
      const agentAvatar = agent.avatar;

      const agentDisplay = agentName ? `${agentName} (ID: ${args.agentId})` : args.agentId;

      // Check if this is the supervisor agent (cannot be removed)
      if (group.supervisorAgentId === args.agentId) {
        return {
          content: `Cannot remove supervisor agent ${agentDisplay} from the group`,
          state: {
            agentAvatar,
            agentId: args.agentId,
            agentName,
            success: false,
          } as RemoveAgentState,
          success: false,
        };
      }

      // Remove the agent from the group via service
      await chatGroupService.removeAgentsFromGroup(groupId, [args.agentId]);

      // Refresh the group detail in the store
      await state.refreshGroupDetail(groupId);

      return {
        content: `Successfully removed agent ${agentDisplay} from the group`,
        state: {
          agentAvatar,
          agentId: args.agentId,
          agentName,
          success: true,
        } as RemoveAgentState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to remove agent: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  // ==================== Group Configuration ====================

  /**
   * Update a specific agent's system prompt (systemRole)
   */
  async updateAgentPrompt(
    groupId: string,
    args: UpdateAgentPromptParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { agentId, prompt } = args;

      // Get previous prompt for state
      const state = getChatGroupStoreState();
      const group = agentGroupSelectors.getGroupById(groupId)(state);
      const agent = group?.agents?.find((a) => a.id === agentId);
      const previousPrompt = agent?.systemRole ?? undefined;

      // Update the agent's systemRole via agent store
      await useAgentStore.getState().updateAgentConfigById(agentId, { systemRole: prompt });

      // Refresh the group detail in the store to sync agent data
      await state.refreshGroupDetail(groupId);

      // IMPORTANT: Directly update the editor content instead of manipulating store data.
      // This bypasses the priority issue between editorData (JSON) and systemRole (markdown).
      // The editor will auto-save and sync both fields properly after the update.
      useGroupProfileStore.getState().setAgentBuilderContent(agentId, prompt);

      const content = prompt
        ? `Successfully updated agent ${agentId} system prompt (${prompt.length} characters)`
        : `Successfully cleared agent ${agentId} system prompt`;

      return {
        content,
        state: {
          agentId,
          newPrompt: prompt,
          previousPrompt,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to update agent prompt: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Update group configuration and metadata (unified method)
   */
  async updateGroup(args: UpdateGroupParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getChatGroupStoreState();
      const group = agentGroupSelectors.currentGroup(state);

      if (!group) {
        return {
          content: 'No active group found',
          error: 'No active group found',
          success: false,
        };
      }

      const { config, meta } = args;

      if (!config && !meta) {
        return {
          content: 'No configuration or metadata provided',
          error: 'No configuration or metadata provided',
          success: false,
        };
      }

      const updatedFields: string[] = [];
      const resultState: UpdateGroupState = { success: true };

      // Update config if provided
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
          await state.updateGroupConfig(configUpdate);
          resultState.updatedConfig = configUpdate;
        }
      }

      // Update meta if provided
      if (meta && Object.keys(meta).length > 0) {
        await state.updateGroupMeta(meta);
        resultState.updatedMeta = meta;

        if (meta.avatar !== undefined) {
          updatedFields.push(`avatar (${meta.avatar || 'cleared'})`);
        }
        if (meta.title !== undefined) {
          updatedFields.push(`title (${meta.title || 'cleared'})`);
        }
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

      // Refresh the group detail in the store to ensure data sync
      await state.refreshGroupDetail(group.id);

      const content = `Successfully updated group: ${updatedFields.join(', ')}`;

      return {
        content,
        state: resultState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to update group: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Update group shared prompt/content
   */
  async updateGroupPrompt(args: UpdateGroupPromptParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getChatGroupStoreState();
      const group = agentGroupSelectors.currentGroup(state);

      if (!group) {
        return {
          content: 'No active group found',
          error: 'No active group found',
          success: false,
        };
      }

      const previousPrompt = group.content ?? undefined;

      if (args.streaming) {
        // Use streaming mode for typewriter effect
        await this.streamUpdateGroupPrompt(args.prompt);
      } else {
        // Update the content directly
        await state.updateGroup(group.id, { content: args.prompt });
      }

      // Refresh the group detail in the store to ensure data sync
      await state.refreshGroupDetail(group.id);

      // IMPORTANT: Directly update the editor content instead of manipulating store data.
      // This bypasses the priority issue between editorData (JSON) and content (markdown).
      // The editor will auto-save and sync both fields properly after the update.
      useGroupProfileStore.getState().setAgentBuilderContent(group.id, args.prompt);

      const content = args.prompt
        ? `Successfully updated group shared prompt (${args.prompt.length} characters)`
        : 'Successfully cleared group shared prompt';

      return {
        content,
        state: {
          newPrompt: args.prompt,
          previousPrompt,
          success: true,
        } as UpdateGroupPromptState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to update group prompt: ${err.message}`,
        error,
        state: {
          newPrompt: args.prompt,
          success: false,
        } as UpdateGroupPromptState,
        success: false,
      };
    }
  }

  /**
   * Stream update group prompt with typewriter effect
   */
  private async streamUpdateGroupPrompt(prompt: string): Promise<void> {
    const state = getChatGroupStoreState();
    const group = agentGroupSelectors.currentGroup(state);

    if (!group) return;

    await state.updateGroup(group.id, { content: prompt });
  }
}

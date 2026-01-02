import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { chatGroupService } from '@/services/chatGroup';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type {
  InviteAgentParams,
  InviteAgentState,
  RemoveAgentParams,
  RemoveAgentState,
  UpdateGroupConfigParams,
  UpdateGroupConfigState,
  UpdateGroupPromptParams,
  UpdateGroupPromptState,
} from '../types';

/**
 * Group Agent Builder Execution Runtime
 * Handles the execution logic for Group Agent Builder APIs
 * Extends AgentBuilder functionality with group-specific operations
 */
export class GroupAgentBuilderExecutionRuntime {
  // ==================== Group-specific Operations ====================

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
      const isAlreadyInGroup = existingAgents.some((a) => a.id === args.agentId);

      if (isAlreadyInGroup) {
        return {
          content: `Agent ${args.agentId} is already in the group`,
          state: {
            agentId: args.agentId,
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

      return {
        content: wasAdded
          ? `Successfully invited agent ${args.agentId} to the group`
          : `Agent ${args.agentId} was already in the group`,
        state: {
          agentId: args.agentId,
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
      const isInGroup = existingAgents.some((a) => a.id === args.agentId);

      if (!isInGroup) {
        return {
          content: `Agent ${args.agentId} is not in the group`,
          state: {
            agentId: args.agentId,
            success: false,
          } as RemoveAgentState,
          success: false,
        };
      }

      // Check if this is the supervisor agent (cannot be removed)
      if (group.supervisorAgentId === args.agentId) {
        return {
          content: `Cannot remove supervisor agent ${args.agentId} from the group`,
          state: {
            agentId: args.agentId,
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
        content: `Successfully removed agent ${args.agentId} from the group`,
        state: {
          agentId: args.agentId,
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

  /**
   * Update group system prompt
   * Unlike regular AgentBuilder, this updates the group's systemPrompt in groupConfig
   */
  async updatePrompt(args: UpdateGroupPromptParams): Promise<BuiltinServerRuntimeOutput> {
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

      const previousPrompt = group.config?.systemPrompt;

      if (args.streaming) {
        // Use streaming mode for typewriter effect
        await this.streamUpdatePrompt(args.prompt);
      } else {
        // Update the system prompt directly
        await state.updateGroupConfig({ systemPrompt: args.prompt });
      }

      const content = args.prompt
        ? `Successfully updated group system prompt (${args.prompt.length} characters)`
        : 'Successfully cleared group system prompt';

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
   * Update group configuration (openingMessage, openingQuestions)
   */
  async updateGroupConfig(args: UpdateGroupConfigParams): Promise<BuiltinServerRuntimeOutput> {
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

      const { config } = args;

      if (!config) {
        return {
          content: 'No configuration provided',
          error: 'No configuration provided',
          success: false,
        };
      }

      // Build the config update object
      const configUpdate: { openingMessage?: string; openingQuestions?: string[] } = {};

      if (config.openingMessage !== undefined) {
        configUpdate.openingMessage = config.openingMessage;
      }

      if (config.openingQuestions !== undefined) {
        configUpdate.openingQuestions = config.openingQuestions;
      }

      // Update the group config
      await state.updateGroupConfig(configUpdate);

      const updatedFields: string[] = [];
      if (config.openingMessage !== undefined) {
        updatedFields.push(
          config.openingMessage
            ? `openingMessage (${config.openingMessage.length} chars)`
            : 'openingMessage (cleared)',
        );
      }
      if (config.openingQuestions !== undefined) {
        updatedFields.push(
          config.openingQuestions.length > 0
            ? `openingQuestions (${config.openingQuestions.length} questions)`
            : 'openingQuestions (cleared)',
        );
      }

      const content = `Successfully updated group configuration: ${updatedFields.join(', ')}`;

      return {
        content,
        state: {
          success: true,
          updatedConfig: configUpdate,
        } as UpdateGroupConfigState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to update group configuration: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Stream update prompt with typewriter effect for group
   */
  private async streamUpdatePrompt(prompt: string): Promise<void> {
    const state = getChatGroupStoreState();

    // Start streaming
    state.startStreamingSystemPrompt();

    // Simulate streaming by chunking the content
    const chunkSize = 5; // Characters per chunk
    const delay = 10; // Milliseconds between chunks

    for (let i = 0; i < prompt.length; i += chunkSize) {
      const chunk = prompt.slice(i, i + chunkSize);
      getChatGroupStoreState().appendStreamingSystemPrompt(chunk);

      // Small delay for typewriter effect
      if (i + chunkSize < prompt.length) {
        // eslint-disable-next-line no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Finish streaming - EditorCanvas will handle save when streaming ends
    await getChatGroupStoreState().finishStreamingSystemPrompt();
  }
}

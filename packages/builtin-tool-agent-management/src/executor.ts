/**
 * Agent Management Executor
 *
 * Handles all agent management tool calls for creating, updating,
 * deleting, searching, and calling AI agents.
 * Delegates to AgentManagerRuntime for actual implementation.
 */
import { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import {
  BaseExecutor,
  type BuiltinToolContext,
  type BuiltinToolResult,
  type ConversationContext,
} from '@lobechat/types';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  AgentManagementApiName,
  AgentManagementIdentifier,
  type CallAgentParams,
  type CallAgentState,
  type CreateAgentParams,
  type DeleteAgentParams,
  type SearchAgentParams,
  type UpdateAgentParams,
} from './types';

const runtime = new AgentManagerRuntime({
  agentService,
  discoverService,
});

class AgentManagementExecutor extends BaseExecutor<typeof AgentManagementApiName> {
  readonly identifier = AgentManagementIdentifier;
  protected readonly apiEnum = AgentManagementApiName;

  // ==================== Agent CRUD ====================

  createAgent = async (params: CreateAgentParams): Promise<BuiltinToolResult> => {
    return runtime.createAgent(params);
  };

  updateAgent = async (params: UpdateAgentParams): Promise<BuiltinToolResult> => {
    const { agentId, config, meta } = params;
    return runtime.updateAgentConfig(agentId, { config, meta });
  };

  deleteAgent = async (params: DeleteAgentParams): Promise<BuiltinToolResult> => {
    return runtime.deleteAgent(params.agentId);
  };

  // ==================== Search ====================

  searchAgent = async (params: SearchAgentParams): Promise<BuiltinToolResult> => {
    return runtime.searchAgents(params);
  };

  // ==================== Execution ====================

  callAgent = async (
    params: CallAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { agentId, instruction, runAsTask, taskTitle, timeout, skipCallSupervisor = false } =
      params;

    if (runAsTask) {
      // Execute as async task using GTD exec_task pattern
      // Pre-load target agent config to ensure it exists
      const targetAgentExists = useAgentStore.getState().agentMap[agentId];
      if (!targetAgentExists) {
        try {
          const config = await agentService.getAgentConfigById(agentId);
          if (!config) {
            return {
              content: `Agent "${agentId}" not found in your workspace. Please check the agent ID and try again.`,
              success: false,
            };
          }
          useAgentStore.getState().internal_dispatchAgentMap(agentId, config);
        } catch (error) {
          console.error('[callAgent] Failed to load agent config:', error);
          return {
            content: `Failed to load agent "${agentId}": ${(error as Error).message}`,
            success: false,
          };
        }
      }

      // Return special state that will be recognized by AgentRuntime's exec_task executor
      // Following GTD execTask pattern: stop: true + state.type = 'execTask'
      return {
        content: `🚀 Triggered async task to call agent "${agentId}"${taskTitle ? `: ${taskTitle}` : ''}`,
        state: {
          parentMessageId: ctx.messageId,
          task: {
            description: taskTitle || `Call agent ${agentId}`,
            instruction,
            targetAgentId: agentId, // Special field for callAgent - indicates target agent
            timeout: timeout || 1_800_000,
          },
          type: 'execTask', // Use same type as GTD to reuse existing executor
        },
        stop: true,
        success: true,
      };
    }

    // Execute as synchronous speak
    // Two modes: Group vs Agents

    // Mode 1: Group environment - use group orchestration
    if (ctx.groupId && ctx.groupOrchestration && ctx.agentId && ctx.registerAfterCompletion) {
      // Register afterCompletion callback to trigger group orchestration
      ctx.registerAfterCompletion(() =>
        ctx.groupOrchestration!.triggerSpeak({
          agentId,
          instruction,
          skipCallSupervisor,
          supervisorAgentId: ctx.agentId!,
        }),
      );

      return {
        content: `Triggered agent "${agentId}" to respond.`,
        state: {
          agentId,
          instruction,
          mode: 'speak',
          skipCallSupervisor,
        } as CallAgentState,
        stop: true,
        success: true,
      };
    }

    // Mode 2: Agents mode (non-group) - execute directly with subAgentId
    if (ctx.registerAfterCompletion) {
      // Pre-load target agent config if not already loaded (before registerAfterCompletion)
      // This ensures we fail fast with a clear error message if agent doesn't exist
      const targetAgentExists = useAgentStore.getState().agentMap[agentId];
      if (!targetAgentExists) {
        try {
          const config = await agentService.getAgentConfigById(agentId);
          if (!config) {
            return {
              content: `Agent "${agentId}" not found in your workspace. Please check the agent ID and try again.`,
              success: false,
            };
          }
          useAgentStore.getState().internal_dispatchAgentMap(agentId, config);
        } catch (error) {
          console.error('[callAgent] Failed to load agent config:', error);
          return {
            content: `Failed to load agent "${agentId}": ${(error as Error).message}`,
            success: false,
          };
        }
      }

      // Register afterCompletion to execute the agent
      ctx.registerAfterCompletion(async () => {
        const get = useChatStore.getState;

        // Build conversation context - use current agent's context
        const conversationContext: ConversationContext = {
          agentId: ctx.agentId || '',
          topicId: ctx.topicId || null,
          // subAgentId will be set when calling internal_execAgentRuntime
        };

        // Get current messages
        const chatKey = messageMapKey(conversationContext);
        const messages = dbMessageSelectors.getDbMessagesByKey(chatKey)(get());

        if (messages.length === 0) {
          console.error('[callAgent] No messages found in current conversation');
          return;
        }

        try {
          // Execute with subAgentId + scope: 'sub_agent'
          // - context.agentId = current agent (for message storage and message.agentId)
          // - context.topicId = current topic
          // - context.subAgentId = target agent (for agent config - model, prompt, etc.)
          // - context.scope = 'sub_agent' (indicates this is agent-to-agent call, not group)
          // This will create messages in current agent's conversation but use target agent's config
          // The message.agentId will still be current agent, but metadata stores subAgentId + scope
          await get().internal_execAgentRuntime({
            context: { ...conversationContext, subAgentId: agentId, scope: 'sub_agent' },
            messages: messages,
            parentMessageId: ctx.messageId,
            parentMessageType: 'tool',
          });
        } catch (error) {
          console.error('[callAgent] internal_execAgentRuntime failed:', error);
          throw error;
        }
      });

      return {
        content: `Called agent "${agentId}" to respond.`,
        state: {
          agentId,
          instruction,
          mode: 'speak',
          skipCallSupervisor,
        } as CallAgentState,
        stop: true,
        success: true,
      };
    }

    // Fallback if registerAfterCompletion not available
    console.warn('[callAgent] registerAfterCompletion not available in context');
    return {
      content: `Called agent "${agentId}" but execution may not complete properly.`,
      state: {
        agentId,
        instruction,
        mode: 'speak',
        skipCallSupervisor,
      } as CallAgentState,
      stop: true,
      success: false,
    };
  };
}

export const agentManagementExecutor = new AgentManagementExecutor();

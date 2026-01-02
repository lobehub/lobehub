/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Lobe Group Management Executor
 *
 * Handles all group management tool calls for multi-agent orchestration.
 */
import {
  BroadcastParams,
  CreateAgentParams,
  CreateWorkflowParams,
  DelegateParams,
  ExecuteTaskParams,
  GetAgentInfoParams,
  GroupManagementApiName,
  GroupManagementIdentifier,
  InterruptParams,
  InviteAgentParams,
  RemoveAgentParams,
  SearchAgentParams,
  SpeakParams,
  SummarizeParams,
  VoteParams,
} from '@lobechat/builtin-tool-group-management';
import { formatAgentProfile } from '@lobechat/prompts';
import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { agentGroupSelectors, useAgentGroupStore } from '@/store/agentGroup';

class GroupManagementExecutor extends BaseExecutor<typeof GroupManagementApiName> {
  readonly identifier = GroupManagementIdentifier;
  protected readonly apiEnum = GroupManagementApiName;

  // ==================== Member Management ====================

  searchAgent = async (
    params: SearchAgentParams,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { query, limit = 10, source = 'user' } = params;

    // Currently only support searching user's own agents
    // Community search can be added in the future
    if (source === 'community') {
      return {
        content:
          'Community agent search is not yet supported. Please use source="user" to search your own agents.',
        state: { agents: [], source, total: 0 },
        success: true,
      };
    }

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
          state: { agents: [], query, total: 0 },
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
        content: `Found ${total} agent${total > 1 ? 's' : ''} matching "${query}":\n${agentList}`,
        state: { agents, query, total },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to search agents: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      };
    }
  };

  inviteAgent = async (
    params: InviteAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { groupId } = ctx;

    if (!groupId) {
      return { content: 'No group context available', success: false };
    }

    try {
      await useAgentGroupStore.getState().addAgentsToGroup(groupId, [params.agentId]);

      return {
        content: `Agent "${params.agentId}" has been invited to the group.`,
        state: { agentId: params.agentId, type: 'inviteAgent' },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to invite agent "${params.agentId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      };
    }
  };

  createAgent = async (
    params: CreateAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { groupId } = ctx;

    if (!groupId) {
      return { content: 'No group context available', success: false };
    }

    try {
      // Create a virtual agent (agents created by supervisor are virtual)
      const result = await agentService.createAgent({
        config: {
          avatar: params.avatar,
          description: params.description,
          systemRole: params.systemRole,
          title: params.title,
          virtual: true,
        },
        groupId,
      });

      if (!result.agentId) {
        return { content: 'Failed to create agent: No agent ID returned', success: false };
      }

      return {
        content: `Agent "${params.title}" has been created and added to the group.`,
        state: { agentId: result.agentId, title: params.title, type: 'createAgent' },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to create agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      };
    }
  };

  removeAgent = async (
    params: RemoveAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { groupId } = ctx;

    if (!groupId) {
      return { content: 'No group context available', success: false };
    }

    try {
      await useAgentGroupStore.getState().removeAgentFromGroup(groupId, params.agentId);

      return {
        content: `Agent "${params.agentId}" has been removed from the group.`,
        state: { agentId: params.agentId, type: 'removeAgent' },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to remove agent "${params.agentId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      };
    }
  };

  getAgentInfo = async (
    params: GetAgentInfoParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { groupId } = ctx;

    if (!groupId) {
      return {
        content: JSON.stringify({ error: 'No group context available', success: false }),
        success: false,
      };
    }

    const agent = agentGroupSelectors.getAgentByIdFromGroup(
      groupId,
      params.agentId,
    )(useAgentGroupStore.getState());

    if (!agent) {
      return { content: `Agent "${params.agentId}" not found in this group`, success: false };
    }

    // Return formatted agent profile for the supervisor
    return { content: formatAgentProfile(agent), state: agent, success: true };
  };

  // ==================== Communication Coordination ====================

  speak = async (params: SpeakParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    // Register afterCompletion callback to trigger orchestration after AgentRuntime completes
    // This avoids race conditions with message updates
    if (ctx.groupOrchestration && ctx.agentId && ctx.registerAfterCompletion) {
      ctx.registerAfterCompletion(() =>
        ctx.groupOrchestration!.triggerSpeak({
          agentId: params.agentId,
          instruction: params.instruction,
          skipCallSupervisor: params.skipCallSupervisor,
          supervisorAgentId: ctx.agentId!,
        }),
      );
    }

    // Returns stop: true to indicate the supervisor should stop and let agent respond
    return {
      content: `Triggered agent "${params.agentId}" to respond.`,
      state: {
        agentId: params.agentId,
        instruction: params.instruction,
        skipCallSupervisor: params.skipCallSupervisor,
        type: 'speak',
      },
      stop: true,
      success: true,
    };
  };

  broadcast = async (
    params: BroadcastParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // Register afterCompletion callback to trigger orchestration after AgentRuntime completes
    // This avoids race conditions with message updates
    if (ctx.groupOrchestration && ctx.agentId && ctx.registerAfterCompletion) {
      ctx.registerAfterCompletion(() =>
        ctx.groupOrchestration!.triggerBroadcast({
          agentIds: params.agentIds,
          instruction: params.instruction,
          skipCallSupervisor: params.skipCallSupervisor,
          supervisorAgentId: ctx.agentId!,
          toolMessageId: ctx.messageId, // Pass tool message ID for correct parent-child relationship
        }),
      );
    }

    // Returns stop: true to trigger multiple agents to respond in parallel
    // metadata.agentCouncil marks this tool message for parallel display in conversation-flow
    return {
      content: `Triggered broadcast to agents: ${params.agentIds.join(', ')}.`,
      metadata: { agentCouncil: true },
      state: {
        agentIds: params.agentIds,
        instruction: params.instruction,
        skipCallSupervisor: params.skipCallSupervisor,
        type: 'broadcast',
      },
      stop: true,
      success: true,
    };
  };

  delegate = async (
    params: DelegateParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // Register afterCompletion callback to trigger orchestration after AgentRuntime completes
    // This avoids race conditions with message updates
    if (ctx.groupOrchestration && ctx.agentId && ctx.registerAfterCompletion) {
      ctx.registerAfterCompletion(() =>
        ctx.groupOrchestration!.triggerDelegate({
          agentId: params.agentId,
          reason: params.reason,
          supervisorAgentId: ctx.agentId!,
        }),
      );
    }

    // The supervisor exits and delegated agent takes control
    return {
      content: `Delegated conversation control to agent "${params.agentId}".`,
      state: {
        agentId: params.agentId,
        reason: params.reason,
        type: 'delegate',
      },
      stop: true,
      success: true,
    };
  };

  // ==================== Task Execution ====================

  executeTask = async (
    params: ExecuteTaskParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // Register afterCompletion callback to trigger async task execution after AgentRuntime completes
    // This follows the same pattern as speak/broadcast - trigger mode, not blocking
    if (ctx.groupOrchestration && ctx.agentId && ctx.registerAfterCompletion) {
      ctx.registerAfterCompletion(() =>
        ctx.groupOrchestration!.triggerExecuteTask({
          agentId: params.agentId,
          skipCallSupervisor: params.skipCallSupervisor,
          supervisorAgentId: ctx.agentId!,
          task: params.task,
          timeout: params.timeout,
          toolMessageId: ctx.messageId,
        }),
      );
    }

    // Returns stop: true to indicate the supervisor should stop and let the task execute
    return {
      content: `Triggered async task for agent "${params.agentId}".`,
      state: {
        agentId: params.agentId,
        skipCallSupervisor: params.skipCallSupervisor,
        task: params.task,
        timeout: params.timeout,
        type: 'executeTask',
      },
      stop: true,
      success: true,
    };
  };

  interrupt = async (
    params: InterruptParams,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { taskId } = params;

    try {
      const { aiAgentService } = await import('@/services/aiAgent');
      const result = await aiAgentService.interruptTask({
        threadId: taskId,
      });

      if (result.success) {
        return {
          content: `Task ${taskId} has been cancelled successfully`,
          state: { cancelled: true, operationId: result.operationId, taskId },
          success: true,
        };
      }

      return {
        content: `Failed to cancel task ${taskId}`,
        state: { cancelled: false, taskId },
        success: false,
      };
    } catch (error) {
      return {
        content: `Failed to interrupt task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      };
    }
  };

  // ==================== Context Management ====================

  summarize = async (
    params: SummarizeParams,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // TODO: Implement conversation summarization
    return {
      content: JSON.stringify({
        focus: params.focus,
        message: 'Summarization not yet implemented',
        preserveRecent: params.preserveRecent,
      }),
      success: true,
    };
  };

  // ==================== Flow Control ====================

  createWorkflow = async (
    params: CreateWorkflowParams,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // TODO: Implement workflow creation
    return {
      content: JSON.stringify({
        message: 'Workflow creation not yet implemented',
        name: params.name,
        steps: params.steps,
      }),
      success: true,
    };
  };

  vote = async (params: VoteParams, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    // TODO: Implement voting mechanism
    return {
      content: JSON.stringify({
        message: 'Voting not yet implemented',
        options: params.options,
        question: params.question,
      }),
      success: true,
    };
  };
}

export const groupManagementExecutor = new GroupManagementExecutor();

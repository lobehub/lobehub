/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Lobe Group Management Executor
 *
 * Handles all group management tool calls for multi-agent orchestration.
 * Note: Member management (searchAgent, inviteAgent, createAgent, removeAgent)
 * is handled by group-agent-builder. This executor focuses on orchestration.
 */
import {
  BroadcastParams,
  CreateWorkflowParams,
  DelegateParams,
  ExecuteTaskParams,
  GetAgentInfoParams,
  GroupManagementApiName,
  GroupManagementIdentifier,
  InterruptParams,
  SpeakParams,
  SummarizeParams,
  VoteParams,
} from '@lobechat/builtin-tool-group-management';
import { formatAgentProfile } from '@lobechat/prompts';
import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { agentGroupSelectors, useAgentGroupStore } from '@/store/agentGroup';

class GroupManagementExecutor extends BaseExecutor<typeof GroupManagementApiName> {
  readonly identifier = GroupManagementIdentifier;
  protected readonly apiEnum = GroupManagementApiName;

  // ==================== Agent Info ====================

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

  executeAgentTask = async (
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
        type: 'executeAgentTask',
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

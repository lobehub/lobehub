/**
 * Group Agent Builder Executor
 *
 * Handles all group agent builder tool calls for configuring groups and their agents.
 * Extends AgentBuilder functionality with group-specific operations.
 */
import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
} from '@lobechat/builtin-tool-agent-builder';
import { AgentBuilderExecutionRuntime } from '@lobechat/builtin-tool-agent-builder/executionRuntime';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { GroupAgentBuilderExecutionRuntime } from './ExecutionRuntime';
import type {
  BatchCreateAgentsParams,
  CreateAgentParams,
  GetAgentInfoParams,
  InviteAgentParams,
  RemoveAgentParams,
  SearchAgentParams,
  UpdateAgentConfigWithIdParams,
  UpdateAgentPromptParams,
  UpdateGroupParams,
  UpdateGroupPromptParams,
} from './types';
import { GroupAgentBuilderApiName, GroupAgentBuilderIdentifier } from './types';

const agentBuilderRuntime = new AgentBuilderExecutionRuntime();
const groupAgentBuilderRuntime = new GroupAgentBuilderExecutionRuntime();

class GroupAgentBuilderExecutor extends BaseExecutor<typeof GroupAgentBuilderApiName> {
  readonly identifier = GroupAgentBuilderIdentifier;
  protected readonly apiEnum = GroupAgentBuilderApiName;

  // ==================== Agent Info ====================

  getAgentInfo = async (
    params: GetAgentInfoParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const result = await groupAgentBuilderRuntime.getAgentInfo(ctx.groupId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  // ==================== Group Member Management ====================

  searchAgent = async (params: SearchAgentParams): Promise<BuiltinToolResult> => {
    const result = await groupAgentBuilderRuntime.searchAgent(params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  createAgent = async (
    params: CreateAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = ctx.groupId;

    if (!groupId) {
      return {
        content: 'No active group found',
        error: { message: 'No active group found', type: 'NoGroupContext' },
        success: false,
      };
    }

    const result = await groupAgentBuilderRuntime.createAgent(groupId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  batchCreateAgents = async (
    params: BatchCreateAgentsParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = ctx.groupId;

    if (!groupId) {
      return {
        content: 'No active group found',
        error: { message: 'No active group found', type: 'NoGroupContext' },
        success: false,
      };
    }

    const result = await groupAgentBuilderRuntime.batchCreateAgents(groupId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  inviteAgent = async (
    params: InviteAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = ctx.groupId;

    if (!groupId) {
      return {
        content: 'No active group found',
        error: { message: 'No active group found', type: 'NoGroupContext' },
        success: false,
      };
    }

    const result = await groupAgentBuilderRuntime.inviteAgent(groupId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  removeAgent = async (
    params: RemoveAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = ctx.groupId;

    if (!groupId) {
      return {
        content: 'No active group found',
        error: { message: 'No active group found', type: 'NoGroupContext' },
        success: false,
      };
    }

    const result = await groupAgentBuilderRuntime.removeAgent(groupId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  // ==================== Group Configuration ====================

  updateAgentPrompt = async (
    params: UpdateAgentPromptParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = ctx.groupId;

    if (!groupId) {
      return {
        content: 'No active group found',
        error: { message: 'No active group found', type: 'NoGroupContext' },
        success: false,
      };
    }

    const result = await groupAgentBuilderRuntime.updateAgentPrompt(groupId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  updateGroup = async (params: UpdateGroupParams): Promise<BuiltinToolResult> => {
    const result = await groupAgentBuilderRuntime.updateGroup(params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  updateGroupPrompt = async (params: UpdateGroupPromptParams): Promise<BuiltinToolResult> => {
    const result = await groupAgentBuilderRuntime.updateGroupPrompt({
      streaming: true,
      ...params,
    });
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  // ==================== Inherited Operations (for supervisor agent) ====================

  getAvailableModels = async (params: GetAvailableModelsParams): Promise<BuiltinToolResult> => {
    const result = await agentBuilderRuntime.getAvailableModels(params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  searchMarketTools = async (params: SearchMarketToolsParams): Promise<BuiltinToolResult> => {
    const result = await agentBuilderRuntime.searchMarketTools(params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  updateConfig = async (
    params: UpdateAgentConfigWithIdParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // Use provided agentId or fall back to supervisor agent from context
    const { agentId: paramAgentId, ...restParams } = params;
    const agentId = paramAgentId ?? ctx.agentId;

    if (!agentId) {
      return {
        content:
          'No agent found. Please provide an agentId or ensure supervisor context is available.',
        error: { message: 'No agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    const result = await agentBuilderRuntime.updateAgentConfig(agentId, restParams);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  installPlugin = async (
    params: InstallPluginParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const agentId = ctx.agentId;

    if (!agentId) {
      return {
        content: 'No supervisor agent found',
        error: { message: 'No supervisor agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    const result = await agentBuilderRuntime.installPlugin(agentId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };
}

export const groupAgentBuilderExecutor = new GroupAgentBuilderExecutor();

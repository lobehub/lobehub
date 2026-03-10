/**
 * Group Agent Builder Executor
 *
 * Handles all group agent builder tool calls for configuring groups and their agents.
 * Extends AgentBuilder functionality with group-specific operations.
 */
import { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
} from '@lobechat/builtin-tool-agent-builder';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';

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

const agentManagerRuntime = new AgentManagerRuntime({
  agentService,
  discoverService,
});
const groupAgentBuilderRuntime = new GroupAgentBuilderExecutionRuntime();

class GroupAgentBuilderExecutor extends BaseExecutor<typeof GroupAgentBuilderApiName> {
  readonly identifier = GroupAgentBuilderIdentifier;
  protected readonly apiEnum = GroupAgentBuilderApiName;

  // ==================== Agent Info ====================

  getAgentInfo = async (
    params: GetAgentInfoParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return groupAgentBuilderRuntime.getAgentInfo(ctx.groupId, params);
  };

  // ==================== Group Member Management ====================

  searchAgent = async (params: SearchAgentParams): Promise<BuiltinToolResult> => {
    return groupAgentBuilderRuntime.searchAgent(params);
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

    return groupAgentBuilderRuntime.createAgent(groupId, params);
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

    return groupAgentBuilderRuntime.batchCreateAgents(groupId, params);
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

    return groupAgentBuilderRuntime.inviteAgent(groupId, params);
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

    return groupAgentBuilderRuntime.removeAgent(groupId, params);
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

    return groupAgentBuilderRuntime.updateAgentPrompt(groupId, params);
  };

  updateGroup = async (params: UpdateGroupParams): Promise<BuiltinToolResult> => {
    return groupAgentBuilderRuntime.updateGroup(params);
  };

  updateGroupPrompt = async (params: UpdateGroupPromptParams): Promise<BuiltinToolResult> => {
    return groupAgentBuilderRuntime.updateGroupPrompt({
      streaming: true,
      ...params,
    });
  };

  // ==================== Inherited Operations (for supervisor agent) ====================

  getAvailableModels = async (params: GetAvailableModelsParams): Promise<BuiltinToolResult> => {
    return agentManagerRuntime.getAvailableModels(params);
  };

  searchMarketTools = async (params: SearchMarketToolsParams): Promise<BuiltinToolResult> => {
    return agentManagerRuntime.searchMarketTools(params);
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

    return agentManagerRuntime.updateAgentConfig(agentId, restParams);
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

    return agentManagerRuntime.installPlugin(agentId, params);
  };
}

export const groupAgentBuilderExecutor = new GroupAgentBuilderExecutor();

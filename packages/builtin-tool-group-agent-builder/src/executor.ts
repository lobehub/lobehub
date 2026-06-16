/**
 * Group Agent Builder Executor
 *
 * Handles all group agent builder tool calls for configuring groups and their agents.
 * Extends AgentBuilder functionality with group-specific operations.
 */
import type { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
} from '@lobechat/builtin-tool-agent-builder';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import type { GroupAgentBuilderExecutionRuntime } from './ExecutionRuntime';
import type {
  BatchCreateAgentsParams,
  CreateAgentParams,
  CreateGroupParams,
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

let agentManagerRuntime: AgentManagerRuntime | undefined;
let agentManagerRuntimePromise: Promise<AgentManagerRuntime> | undefined;
let groupAgentBuilderRuntime: GroupAgentBuilderExecutionRuntime | undefined;
let groupAgentBuilderRuntimePromise: Promise<GroupAgentBuilderExecutionRuntime> | undefined;

const getAgentManagerRuntime = async () => {
  if (agentManagerRuntime) return agentManagerRuntime;

  agentManagerRuntimePromise ??= Promise.all([
    import('@lobechat/agent-manager-runtime'),
    import('@/services/agent'),
    import('@/services/discover'),
  ]).then(([{ AgentManagerRuntime }, { agentService }, { discoverService }]) => {
    agentManagerRuntime = new AgentManagerRuntime({
      agentService,
      discoverService,
    });

    return agentManagerRuntime;
  });

  return agentManagerRuntimePromise;
};

const getGroupAgentBuilderRuntime = async () => {
  if (groupAgentBuilderRuntime) return groupAgentBuilderRuntime;

  groupAgentBuilderRuntimePromise ??= import('./ExecutionRuntime').then(
    ({ GroupAgentBuilderExecutionRuntime }) => {
      groupAgentBuilderRuntime = new GroupAgentBuilderExecutionRuntime();

      return groupAgentBuilderRuntime;
    },
  );

  return groupAgentBuilderRuntimePromise;
};

class GroupAgentBuilderExecutor extends BaseExecutor<typeof GroupAgentBuilderApiName> {
  readonly identifier = GroupAgentBuilderIdentifier;
  protected readonly apiEnum = GroupAgentBuilderApiName;

  // ==================== Agent Info ====================

  getAgentInfo = async (
    params: GetAgentInfoParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return (await getGroupAgentBuilderRuntime()).getAgentInfo(ctx.groupId, params);
  };

  // ==================== Group Member Management ====================

  searchAgent = async (params: SearchAgentParams): Promise<BuiltinToolResult> => {
    return (await getGroupAgentBuilderRuntime()).searchAgent(params);
  };

  createGroup = async (params: CreateGroupParams): Promise<BuiltinToolResult> => {
    return (await getGroupAgentBuilderRuntime()).createGroup(params);
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

    return (await getGroupAgentBuilderRuntime()).createAgent(groupId, params);
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

    return (await getGroupAgentBuilderRuntime()).batchCreateAgents(groupId, params);
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

    return (await getGroupAgentBuilderRuntime()).inviteAgent(groupId, params);
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

    return (await getGroupAgentBuilderRuntime()).removeAgent(groupId, params);
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

    return (await getGroupAgentBuilderRuntime()).updateAgentPrompt(groupId, params);
  };

  updateGroup = async (params: UpdateGroupParams): Promise<BuiltinToolResult> => {
    return (await getGroupAgentBuilderRuntime()).updateGroup(params);
  };

  updateGroupPrompt = async (params: UpdateGroupPromptParams): Promise<BuiltinToolResult> => {
    return (await getGroupAgentBuilderRuntime()).updateGroupPrompt({
      streaming: true,
      ...params,
    });
  };

  // ==================== Inherited Operations (for supervisor agent) ====================

  getAvailableModels = async (params: GetAvailableModelsParams): Promise<BuiltinToolResult> => {
    return (await getAgentManagerRuntime()).getAvailableModels(params);
  };

  searchMarketTools = async (params: SearchMarketToolsParams): Promise<BuiltinToolResult> => {
    return (await getAgentManagerRuntime()).searchMarketTools(params);
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

    return (await getAgentManagerRuntime()).updateAgentConfig(agentId, restParams);
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

    return (await getAgentManagerRuntime()).installPlugin(agentId, params);
  };
}

export const groupAgentBuilderExecutor = new GroupAgentBuilderExecutor();

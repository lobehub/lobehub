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
import type { BuiltinToolContext, BuiltinToolResult, ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { useGroupProfileStore } from '@/store/groupProfile';

import { GroupAgentBuilderExecutionRuntime } from './ExecutionRuntime';
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

const agentManagerRuntime = new AgentManagerRuntime({
  agentService,
  discoverService,
});
const groupAgentBuilderRuntime = new GroupAgentBuilderExecutionRuntime();

// APIs that mutate group / member state. Under gateway mode these commit inside
// the server runtime, so the client stores only learn about them through
// `onAfterCall` (fired on `tool_end` regardless of where the tool ran).
const GROUP_WRITE_APIS = new Set<string>([
  GroupAgentBuilderApiName.batchCreateAgents,
  GroupAgentBuilderApiName.createAgent,
  GroupAgentBuilderApiName.inviteAgent,
  GroupAgentBuilderApiName.removeAgent,
  GroupAgentBuilderApiName.updateAgentPrompt,
  GroupAgentBuilderApiName.updateGroup,
  GroupAgentBuilderApiName.updateGroupPrompt,
]);

/**
 * The Group Agent Builder conversation is keyed by the builtin builder agent, so
 * its ConversationContext deliberately carries no groupId. The edited group is
 * whatever the profile page has active — the same source `resolveGroupTarget`
 * already uses for the group-level APIs.
 */
const resolveActiveGroupId = (ctx: BuiltinToolContext): string | undefined =>
  ctx.groupId ?? getChatGroupStoreState().activeGroupId ?? undefined;

const NO_GROUP_CONTEXT: BuiltinToolResult = {
  content: 'No active group found',
  error: { message: 'No active group found', type: 'NoGroupContext' },
  success: false,
};

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

  createGroup = async (params: CreateGroupParams): Promise<BuiltinToolResult> => {
    return groupAgentBuilderRuntime.createGroup(params);
  };

  createAgent = async (
    params: CreateAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = resolveActiveGroupId(ctx);

    if (!groupId) return NO_GROUP_CONTEXT;

    return groupAgentBuilderRuntime.createAgent(groupId, params);
  };

  batchCreateAgents = async (
    params: BatchCreateAgentsParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = resolveActiveGroupId(ctx);

    if (!groupId) return NO_GROUP_CONTEXT;

    return groupAgentBuilderRuntime.batchCreateAgents(groupId, params);
  };

  inviteAgent = async (
    params: InviteAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = resolveActiveGroupId(ctx);

    if (!groupId) return NO_GROUP_CONTEXT;

    return groupAgentBuilderRuntime.inviteAgent(groupId, params);
  };

  removeAgent = async (
    params: RemoveAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = resolveActiveGroupId(ctx);

    if (!groupId) return NO_GROUP_CONTEXT;

    return groupAgentBuilderRuntime.removeAgent(groupId, params);
  };

  // ==================== Group Configuration ====================

  updateAgentPrompt = async (
    params: UpdateAgentPromptParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const groupId = resolveActiveGroupId(ctx);

    if (!groupId) return NO_GROUP_CONTEXT;

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

  // ==================== Hooks ====================

  /**
   * Under gateway mode these tools run in the server runtime, so the client-side
   * `refreshGroupDetail` inside `GroupAgentBuilderExecutionRuntime` never fires
   * and the group Profile sidebar keeps showing the pre-change roster. This hook
   * runs on `tool_end` for both transports, so it is the one place that reliably
   * re-syncs the stores after a write.
   */
  onAfterCall = async ({ apiName, params, result }: ToolAfterCallContext): Promise<void> => {
    const groupStore = getChatGroupStoreState();

    // A brand-new group isn't in the list yet — refresh the list, not a detail.
    if (apiName === GroupAgentBuilderApiName.createGroup) {
      if (result.success) await groupStore.refreshGroups();
      return;
    }

    if (!result.success || !GROUP_WRITE_APIS.has(apiName)) return;

    const args = (params ?? {}) as { agentId?: string; groupId?: string; prompt?: string };
    const groupId = args.groupId ?? groupStore.activeGroupId;
    if (!groupId) return;

    await groupStore.refreshGroupDetail(groupId);

    // Prompt writes must also land in the open editor: it treats its own JSON
    // doc as authoritative and would otherwise autosave the stale text back over
    // the change the agent just made.
    if (apiName === GroupAgentBuilderApiName.updateAgentPrompt && args.agentId) {
      useGroupProfileStore.getState().setAgentBuilderContent(args.agentId, args.prompt ?? '');
    }
    if (apiName === GroupAgentBuilderApiName.updateGroupPrompt) {
      useGroupProfileStore.getState().setAgentBuilderContent(groupId, args.prompt ?? '');
    }
  };
}

export const groupAgentBuilderExecutor = new GroupAgentBuilderExecutor();

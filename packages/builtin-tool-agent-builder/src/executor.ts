/**
 * Agent Builder Executor
 *
 * Handles all agent builder tool calls for configuring and customizing agents.
 * Delegates to AgentManagerRuntime for actual implementation.
 */
import { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';

import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
  UpdateAgentConfigParams,
  UpdatePromptParams,
} from './types';
import { AgentBuilderApiName, AgentBuilderIdentifier } from './types';

const runtime = new AgentManagerRuntime({
  agentService,
  discoverService,
});

class AgentBuilderExecutor extends BaseExecutor<typeof AgentBuilderApiName> {
  readonly identifier = AgentBuilderIdentifier;
  protected readonly apiEnum = AgentBuilderApiName;

  // ==================== Read Operations ====================

  getAvailableModels = async (params: GetAvailableModelsParams): Promise<BuiltinToolResult> => {
    return runtime.getAvailableModels(params);
  };

  searchMarketTools = async (params: SearchMarketToolsParams): Promise<BuiltinToolResult> => {
    return runtime.searchMarketTools(params);
  };

  // ==================== Write Operations ====================

  updateConfig = async (
    params: UpdateAgentConfigParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const agentId = ctx.agentId;

    if (!agentId) {
      return {
        content: 'No active agent found',
        error: { message: 'No active agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    return runtime.updateAgentConfig(agentId, params);
  };

  updatePrompt = async (
    params: UpdatePromptParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const agentId = ctx.agentId;

    if (!agentId) {
      return {
        content: 'No active agent found',
        error: { message: 'No active agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    return runtime.updatePrompt(agentId, {
      streaming: true,
      ...params,
    });
  };

  installPlugin = async (
    params: InstallPluginParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const agentId = ctx.agentId;

    if (!agentId) {
      return {
        content: 'No active agent found',
        error: { message: 'No active agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    return runtime.installPlugin(agentId, params);
  };
}

export const agentBuilderExecutor = new AgentBuilderExecutor();

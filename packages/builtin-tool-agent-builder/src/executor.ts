/**
 * Agent Builder Executor
 *
 * Handles all agent builder tool calls for configuring and customizing agents.
 * Delegates to AgentManagerRuntime for actual implementation.
 */
import { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import type { BuiltinToolContext, BuiltinToolResult, ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { getChatStoreState } from '@/store/chat';
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

// Write APIs that mutate agent state and require a client-side store refresh.
const WRITE_APIS = new Set<string>([
  AgentBuilderApiName.updateAgentConfig,
  AgentBuilderApiName.updatePrompt,
  AgentBuilderApiName.installPlugin,
]);

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

  // ==================== Hooks ====================

  onAfterCall = async ({ apiName, result }: ToolAfterCallContext): Promise<void> => {
    if (!result.success || !WRITE_APIS.has(apiName)) return;

    // AgentBuilderProvider keeps chatStore.activeAgentId in sync with the agent
    // being edited. After a successful write the server has already updated the
    // DB, so we re-fetch the config here to update the Zustand store and
    // re-render the left-sidebar without requiring a page reload.
    const editingAgentId = getChatStoreState().activeAgentId;
    if (!editingAgentId) return;

    await getAgentStoreState().internal_refreshAgentConfig(editingAgentId);
  };
}

export const agentBuilderExecutor = new AgentBuilderExecutor();

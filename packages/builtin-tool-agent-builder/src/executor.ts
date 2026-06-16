/**
 * Agent Builder Executor
 *
 * Handles all agent builder tool calls for configuring and customizing agents.
 * Delegates to AgentManagerRuntime for actual implementation.
 */
import type { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import type { BuiltinToolContext, BuiltinToolResult, ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

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

let runtime: AgentManagerRuntime | undefined;
let runtimePromise: Promise<AgentManagerRuntime> | undefined;

const getRuntime = async () => {
  if (runtime) return runtime;

  runtimePromise ??= Promise.all([
    import('@lobechat/agent-manager-runtime'),
    import('@/services/agent'),
    import('@/services/discover'),
  ]).then(([{ AgentManagerRuntime }, { agentService }, { discoverService }]) => {
    runtime = new AgentManagerRuntime({
      agentService,
      discoverService,
    });

    return runtime;
  });

  return runtimePromise;
};

class AgentBuilderExecutor extends BaseExecutor<typeof AgentBuilderApiName> {
  readonly identifier = AgentBuilderIdentifier;
  protected readonly apiEnum = AgentBuilderApiName;

  // ==================== Read Operations ====================

  getAvailableModels = async (params: GetAvailableModelsParams): Promise<BuiltinToolResult> => {
    return (await getRuntime()).getAvailableModels(params);
  };

  searchMarketTools = async (params: SearchMarketToolsParams): Promise<BuiltinToolResult> => {
    return (await getRuntime()).searchMarketTools(params);
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

    return (await getRuntime()).updateAgentConfig(agentId, params);
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

    return (await getRuntime()).updatePrompt(agentId, {
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

    return (await getRuntime()).installPlugin(agentId, params);
  };

  // ==================== Hooks ====================

  onAfterCall = async ({ apiName, result }: ToolAfterCallContext): Promise<void> => {
    if (!result.success || !WRITE_APIS.has(apiName)) return;

    // AgentBuilderProvider keeps chatStore.activeAgentId in sync with the agent
    // being edited. After a successful write the server has already updated the
    // DB, so we re-fetch the config here to update the Zustand store and
    // re-render the left-sidebar without requiring a page reload.
    const [{ getChatStoreState }, { getAgentStoreState }] = await Promise.all([
      import('@/store/chat'),
      import('@/store/agent'),
    ]);

    const editingAgentId = getChatStoreState().activeAgentId;
    if (!editingAgentId) return;

    await getAgentStoreState().internal_refreshAgentConfig(editingAgentId);
  };
}

export const agentBuilderExecutor = new AgentBuilderExecutor();

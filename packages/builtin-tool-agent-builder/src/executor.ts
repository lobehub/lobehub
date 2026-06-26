/**
 * Agent Builder Executor
 *
 * Handles all agent builder tool calls for configuring and customizing agents.
 * Delegates to AgentManagerRuntime for actual implementation.
 */
import { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import type { BuiltinToolContext, BuiltinToolResult, ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { getAgentStoreState } from '@/store/agent';
import { getChatStoreState } from '@/store/chat';

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
    // AgentBuilderProvider keeps chatStore.activeAgentId in sync with the agent
    // being edited. After a successful write the server has already updated the
    // DB, so we re-fetch the config here to update the Zustand store and
    // re-render the left-sidebar without requiring a page reload.
    const editingAgentId = getChatStoreState().activeAgentId;

    if (!result.success || !WRITE_APIS.has(apiName)) return;
    if (!editingAgentId) return;

    const agentStore = getAgentStoreState();

    // updatePrompt streaming fill:
    // In CLIENT mode the AgentManagerRuntime streams the new prompt into the
    // left profile editor via the agent store's streamingSystemRole (typewriter
    // effect). In GATEWAY mode the prompt is written server-side, so no client
    // streaming happens. `onAfterCall` ONLY fires for gateway tools, so we
    // reproduce the same typewriter fill here using the SAME mechanism the
    // editor already listens to — no double-stream risk in client mode. The
    // animation persists the final systemRole; we still refresh afterwards to
    // pull the server-cleared editorData and any other fields.
    if (apiName === AgentBuilderApiName.updatePrompt) {
      const newPrompt = (result.state as { newPrompt?: string } | undefined)?.newPrompt ?? '';
      agentStore.startStreamingSystemRole();
      // Fire-and-forget so the gateway event handler isn't blocked for the whole
      // animation; the editor reacts to streamingSystemRole reactively.
      void (async () => {
        try {
          const chunkSize = 5;
          const delay = 10;
          for (let i = 0; i < newPrompt.length; i += chunkSize) {
            agentStore.appendStreamingSystemRole(newPrompt.slice(i, i + chunkSize));
            if (i + chunkSize < newPrompt.length) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        } finally {
          await agentStore.finishStreamingSystemRole(editingAgentId);
          await agentStore.internal_refreshAgentConfig(editingAgentId);
        }
      })();
      return;
    }

    await agentStore.internal_refreshAgentConfig(editingAgentId);
  };
}

export const agentBuilderExecutor = new AgentBuilderExecutor();

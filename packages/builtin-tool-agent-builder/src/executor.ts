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

// Generation token for the gateway updatePrompt typewriter animation. The
// streamingSystemRole buffer in the agent store is a singleton, and gateway
// `tool_end` events fan out (gatewayEventHandler dispatches onAfterCall without
// serializing across invocations). A newer updatePrompt therefore bumps this
// counter so any in-flight animation stops appending and does NOT finalize —
// only the latest run persists, preventing interleaved / partial prompt text.
// (The client runtime awaits its stream during tool execution and is naturally
// serialized, so this guard is gateway-only.)
let updatePromptStreamGeneration = 0;

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
      // Claim this animation; a later updatePrompt bumps the counter to supersede it.
      const generation = ++updatePromptStreamGeneration;
      agentStore.startStreamingSystemRole();
      // Fire-and-forget so the gateway event handler isn't blocked for the whole
      // animation; the editor reacts to streamingSystemRole reactively. The
      // generation guard keeps concurrent animations from corrupting the shared
      // buffer (see updatePromptStreamGeneration above).
      void (async () => {
        try {
          const chunkSize = 5;
          const delay = 10;
          for (let i = 0; i < newPrompt.length; i += chunkSize) {
            // A newer updatePrompt has taken over the shared buffer — stop here
            // and let the latest run own the stream.
            if (updatePromptStreamGeneration !== generation) return;
            agentStore.appendStreamingSystemRole(newPrompt.slice(i, i + chunkSize));
            if (i + chunkSize < newPrompt.length) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        } finally {
          // Only the latest animation finalizes/persists, so a superseded run
          // never writes interleaved or partial prompt text.
          if (updatePromptStreamGeneration === generation) {
            await agentStore.finishStreamingSystemRole(editingAgentId);
            await agentStore.internal_refreshAgentConfig(editingAgentId);
          }
        }
      })();
      return;
    }

    await agentStore.internal_refreshAgentConfig(editingAgentId);
  };
}

export const agentBuilderExecutor = new AgentBuilderExecutor();

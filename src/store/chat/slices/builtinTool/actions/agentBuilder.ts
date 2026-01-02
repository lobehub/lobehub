import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
  UpdateAgentConfigParams,
  UpdatePromptParams,
} from '@lobechat/builtin-tool-agent-builder';
import { AgentBuilderExecutionRuntime } from '@lobechat/builtin-tool-agent-builder/executionRuntime';
import debug from 'debug';
import { type StateCreator } from 'zustand/vanilla';

import { getAgentStoreState } from '@/store/agent';
import { type ChatStore } from '@/store/chat/store';

const log = debug('lobe-store:builtin-tool:agent-builder');

export interface AgentBuilderAction {
  getAvailableModels: (id: string, params: GetAvailableModelsParams) => Promise<boolean>;
  installPlugin: (id: string, params: InstallPluginParams) => Promise<boolean>;
  internal_triggerAgentBuilderToolCalling: (
    id: string,
    apiName: string,
    params: any,
  ) => Promise<boolean>;
  searchMarketTools: (id: string, params: SearchMarketToolsParams) => Promise<boolean>;
  updateConfig: (id: string, params: UpdateAgentConfigParams) => Promise<boolean>;
  updatePrompt: (id: string, params: UpdatePromptParams) => Promise<boolean>;
}

const runtime = new AgentBuilderExecutionRuntime();

export const agentBuilderSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  AgentBuilderAction
> = (set, get) => ({
  // ==================== Read Operations ====================

  getAvailableModels: async (id, params) => {
    return get().internal_triggerAgentBuilderToolCalling(id, 'getAvailableModels', params);
  },

  installPlugin: async (id, params) => {
    return get().internal_triggerAgentBuilderToolCalling(id, 'installPlugin', params);
  },

  // ==================== Internal Helper ====================
  /**
   * Internal helper to execute agent builder tool calling operations
   * Handles operation tracking, error handling, and state updates
   */
  internal_triggerAgentBuilderToolCalling: async (id, apiName, params) => {
    // Get parent operationId from messageOperationMap (should be executeToolCall)
    const parentOperationId = get().messageOperationMap[id];

    // Create child operation for agent builder execution
    // Auto-associates message with this operation via messageId in context
    const { operationId, abortController } = get().startOperation({
      context: {
        messageId: id,
      },
      metadata: {
        apiName,
        params,
        startTime: Date.now(),
      },
      parentOperationId,
      type: 'builtinToolAgentBuilder',
    });

    log(
      '[%s] messageId=%s, parentOpId=%s, opId=%s, aborted=%s',
      apiName,
      id,
      parentOperationId,
      operationId,
      abortController.signal.aborted,
    );

    const context = { operationId };

    try {
      // Get target agent ID from AgentStore, not ChatStore
      // ChatStore's activeAgentId is for message scoping (might be AgentBuilder's own ID)
      // AgentStore's activeAgentId is the actual target agent being configured
      const agentId = getAgentStoreState().activeAgentId;

      if (!agentId) {
        throw new Error('No active agent found');
      }

      // Execute the runtime method
      let result;
      switch (apiName) {
        case 'updateAgentConfig':
        case 'updateConfig': {
          result = await runtime.updateAgentConfig(agentId, params as UpdateAgentConfigParams);
          break;
        }
        case 'getAvailableModels': {
          result = await runtime.getAvailableModels(params as GetAvailableModelsParams);
          break;
        }
        case 'searchMarketTools': {
          result = await runtime.searchMarketTools(params as SearchMarketToolsParams);
          break;
        }
        case 'installPlugin': {
          result = await runtime.installPlugin(agentId, params as InstallPluginParams);
          break;
        }
        case 'updatePrompt': {
          result = await runtime.updatePrompt(agentId, {
            streaming: true,
            ...params,
          } as UpdatePromptParams);
          break;
        }
        default: {
          throw new Error(`Unknown API name: ${apiName}`);
        }
      }

      const { content, success, error, state } = result;

      // Complete operation
      get().completeOperation(operationId);

      // Update message content
      await get().optimisticUpdateMessageContent(id, content, undefined, context);

      if (success) {
        // Update plugin state with the result
        await get().optimisticUpdatePluginState(id, state, context);
      } else {
        // Update plugin error
        await get().optimisticUpdatePluginError(id, error, context);
      }

      return true;
    } catch (error) {
      const err = error as Error;

      log('[%s] Error: messageId=%s, error=%s', apiName, id, err.message);

      // Check if it's an abort error
      if (err.message.includes('The user aborted a request.') || err.name === 'AbortError') {
        log('[%s] Request aborted: messageId=%s', apiName, id);
        // Fail operation for abort
        get().failOperation(operationId, {
          message: 'User cancelled the request',
          type: 'UserAborted',
        });
        // Don't update error message for user aborts
        return true;
      }

      // Fail operation for other errors
      get().failOperation(operationId, {
        message: err.message,
        type: 'PluginServerError',
      });

      // For other errors, update message
      await get().optimisticUpdateMessagePluginError(
        id,
        {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        context,
      );

      return true;
    }
  },

  searchMarketTools: async (id, params) => {
    return get().internal_triggerAgentBuilderToolCalling(id, 'searchMarketTools', params);
  },

  // ==================== Write Operations ====================
  updateConfig: async (id, params) => {
    return get().internal_triggerAgentBuilderToolCalling(id, 'updateConfig', params);
  },

  updatePrompt: async (id, params) => {
    return get().internal_triggerAgentBuilderToolCalling(id, 'updatePrompt', params);
  },
});

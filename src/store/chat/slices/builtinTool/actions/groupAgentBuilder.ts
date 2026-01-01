import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
  UpdateAgentConfigParams,
} from '@lobechat/builtin-tool-agent-builder';
import { AgentBuilderExecutionRuntime } from '@lobechat/builtin-tool-agent-builder/executionRuntime';
import type {
  InviteAgentParams,
  RemoveAgentParams,
  UpdateGroupConfigParams,
  UpdateGroupPromptParams,
} from '@lobechat/builtin-tool-group-agent-builder';
import { GroupAgentBuilderExecutionRuntime } from '@lobechat/builtin-tool-group-agent-builder/executionRuntime';
import debug from 'debug';
import { type StateCreator } from 'zustand/vanilla';

import { getAgentStoreState } from '@/store/agent';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { type ChatStore } from '@/store/chat/store';

const log = debug('lobe-store:builtin-tool:group-agent-builder');

export interface GroupAgentBuilderAction {
  // Inherited operations from AgentBuilder (operate on supervisor agent)
  groupAgentBuilder_getAvailableModels: (
    id: string,
    params: GetAvailableModelsParams,
  ) => Promise<boolean>;
  groupAgentBuilder_installPlugin: (id: string, params: InstallPluginParams) => Promise<boolean>;
  // Group-specific operations
  groupAgentBuilder_inviteAgent: (id: string, params: InviteAgentParams) => Promise<boolean>;
  groupAgentBuilder_removeAgent: (id: string, params: RemoveAgentParams) => Promise<boolean>;
  groupAgentBuilder_searchMarketTools: (
    id: string,
    params: SearchMarketToolsParams,
  ) => Promise<boolean>;
  groupAgentBuilder_updateConfig: (id: string, params: UpdateAgentConfigParams) => Promise<boolean>;
  groupAgentBuilder_updateGroupConfig: (
    id: string,
    params: UpdateGroupConfigParams,
  ) => Promise<boolean>;
  groupAgentBuilder_updatePrompt: (id: string, params: UpdateGroupPromptParams) => Promise<boolean>;
  internal_triggerGroupAgentBuilderToolCalling: (
    id: string,
    apiName: string,
    params: any,
  ) => Promise<boolean>;
}

const agentBuilderRuntime = new AgentBuilderExecutionRuntime();
const groupAgentBuilderRuntime = new GroupAgentBuilderExecutionRuntime();

export const groupAgentBuilderSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  GroupAgentBuilderAction
> = (set, get) => ({
  // ==================== Inherited Operations (from AgentBuilder) ====================
  groupAgentBuilder_getAvailableModels: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'getAvailableModels', params);
  },

  groupAgentBuilder_installPlugin: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'installPlugin', params);
  },

  // ==================== Group-specific Operations ====================
  groupAgentBuilder_inviteAgent: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'inviteAgent', params);
  },

  groupAgentBuilder_removeAgent: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'removeAgent', params);
  },

  groupAgentBuilder_searchMarketTools: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'searchMarketTools', params);
  },

  groupAgentBuilder_updateConfig: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'updateConfig', params);
  },

  groupAgentBuilder_updateGroupConfig: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'updateGroupConfig', params);
  },

  groupAgentBuilder_updatePrompt: async (id, params) => {
    return get().internal_triggerGroupAgentBuilderToolCalling(id, 'updatePrompt', params);
  },

  // ==================== Internal Helper ====================

  internal_triggerGroupAgentBuilderToolCalling: async (id, apiName, params) => {
    // Get parent operationId from messageOperationMap (should be executeToolCall)
    const parentOperationId = get().messageOperationMap[id];

    // Create child operation for group agent builder execution
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
      type: 'builtinToolGroupAgentBuilder',
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
      // Get the active group ID
      const groupId = getChatGroupStoreState().activeGroupId;
      if (!groupId) {
        throw new Error('No active group found');
      }

      // Get supervisor agent ID for config/model operations
      const agentId = getAgentStoreState().activeAgentId;

      // Execute the runtime method
      let result;
      switch (apiName) {
        // Group-specific operations
        case 'inviteAgent': {
          result = await groupAgentBuilderRuntime.inviteAgent(groupId, params as InviteAgentParams);
          break;
        }
        case 'removeAgent': {
          result = await groupAgentBuilderRuntime.removeAgent(groupId, params as RemoveAgentParams);
          break;
        }
        case 'updatePrompt': {
          result = await groupAgentBuilderRuntime.updatePrompt({
            streaming: true,
            ...params,
          } as UpdateGroupPromptParams);
          break;
        }
        case 'updateGroupConfig': {
          result = await groupAgentBuilderRuntime.updateGroupConfig(
            params as UpdateGroupConfigParams,
          );
          break;
        }
        // Inherited operations (use AgentBuilder runtime for supervisor agent)
        case 'updateAgentConfig':
        case 'updateConfig': {
          if (!agentId) throw new Error('No supervisor agent found');
          result = await agentBuilderRuntime.updateAgentConfig(
            agentId,
            params as UpdateAgentConfigParams,
          );
          break;
        }
        case 'getAvailableModels': {
          result = await agentBuilderRuntime.getAvailableModels(params as GetAvailableModelsParams);
          break;
        }
        case 'searchMarketTools': {
          result = await agentBuilderRuntime.searchMarketTools(params as SearchMarketToolsParams);
          break;
        }
        case 'installPlugin': {
          if (!agentId) throw new Error('No supervisor agent found');
          result = await agentBuilderRuntime.installPlugin(agentId, params as InstallPluginParams);
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
});

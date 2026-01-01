import debug from 'debug';
import { type StateCreator } from 'zustand/vanilla';

import { agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { type ChatStore } from '@/store/chat/store';
import { KnowledgeBaseExecutionRuntime } from '@/tools/knowledge-base/ExecutionRuntime';

const log = debug('lobe-store:builtin-tool:knowledge-base');

export interface KnowledgeBaseAction {
  internal_triggerKnowledgeBaseToolCalling: (
    id: string,
    callingService: () => Promise<{ content: string; error?: any; state?: any; success: boolean }>,
  ) => Promise<boolean>;

  /**
   * Read full content of specific files from knowledge base
   */
  readKnowledge: (
    id: string,
    params: {
      fileIds: string[];
    },
  ) => Promise<boolean>;

  /**
   * Search knowledge base for relevant files and chunks
   */
  searchKnowledgeBase: (
    id: string,
    params: {
      query: string;
      topK?: number;
    },
  ) => Promise<boolean>;
}

const runtime = new KnowledgeBaseExecutionRuntime();

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const knowledgeBaseSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  KnowledgeBaseAction
> = (set, get) => ({
  readKnowledge: async (id, params) => {
    return get().internal_triggerKnowledgeBaseToolCalling(id, async () => {
      return await runtime.readKnowledge(params);
    });
  },

  searchKnowledgeBase: async (id, params) => {
    // Get knowledge base IDs from agent store
    const agentState = getAgentStoreState();
    const knowledgeIds = agentSelectors.currentKnowledgeIds(agentState);

    // Only search in knowledge bases, not agent files
    // Agent files will be injected as full content in context-engine
    const knowledgeBaseIds = knowledgeIds.knowledgeBaseIds;

    return get().internal_triggerKnowledgeBaseToolCalling(id, async () => {
      return await runtime.searchKnowledgeBase(params, {
        knowledgeBaseIds,
        messageId: id,
      });
    });
  },

  // ==================== utils ====================

  internal_triggerKnowledgeBaseToolCalling: async (id, callingService) => {
    // Get parent operationId from messageOperationMap (should be executeToolCall)
    const parentOperationId = get().messageOperationMap[id];

    // Create child operation for knowledge base execution
    // Auto-associates message with this operation via messageId in context
    const { operationId: knowledgeBaseOpId, abortController } = get().startOperation({
      context: {
        messageId: id,
      },
      metadata: {
        startTime: Date.now(),
      },
      parentOperationId,
      type: 'builtinToolKnowledgeBase',
    });

    log(
      '[knowledgeBase] messageId=%s, parentOpId=%s, knowledgeBaseOpId=%s, aborted=%s',
      id,
      parentOperationId,
      knowledgeBaseOpId,
      abortController.signal.aborted,
    );

    const context = { operationId: knowledgeBaseOpId };

    try {
      const { state, content, success, error } = await callingService();

      // Complete knowledge base operation
      get().completeOperation(knowledgeBaseOpId);

      if (success) {
        if (state) {
          await get().optimisticUpdatePluginState(id, state, context);
        }
        await get().optimisticUpdateMessageContent(id, content, undefined, context);
      } else {
        await get().optimisticUpdateMessagePluginError(
          id,
          {
            body: error,
            message: error?.message || 'Operation failed',
            type: 'PluginServerError',
          },
          context,
        );
        // Still update content even if failed, to show error message
        await get().optimisticUpdateMessageContent(id, content, undefined, context);
      }

      return true;
    } catch (error) {
      const err = error as Error;

      log('[knowledgeBase] Error: messageId=%s, error=%s', id, err.message);

      // Check if it's an abort error
      if (err.message.includes('The user aborted a request.') || err.name === 'AbortError') {
        log('[knowledgeBase] Request aborted: messageId=%s', id);
        // Fail knowledge base operation for abort
        get().failOperation(knowledgeBaseOpId, {
          message: 'User cancelled the request',
          type: 'UserAborted',
        });
        // Don't update error message for user aborts
        return false;
      }

      // Fail knowledge base operation for other errors
      get().failOperation(knowledgeBaseOpId, {
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

      return false;
    }
  },
});

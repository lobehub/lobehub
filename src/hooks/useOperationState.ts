import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { type ConversationContext, type OperationState } from '@/features/Conversation/types';
import {
  DEFAULT_MESSAGE_OPERATION_STATE,
  DEFAULT_TOOL_OPERATION_STATE,
} from '@/features/Conversation/types/operation';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * Hook to create an OperationState object from ChatStore
 *
 * This hook subscribes to the ChatStore and builds an OperationState object
 * that can be passed to ConversationProvider for reactive updates.
 *
 * @param context - The conversation context (sessionId, topicId, threadId)
 * @returns OperationState object with reactive getters
 */
export const useOperationState = (context: ConversationContext): OperationState => {
  const contextKey = messageMapKey(context);

  // Subscribe to the relevant parts of ChatStore for reactivity
  const { operations, operationsByContext, operationsByMessage, toolCallingStreamIds } =
    useChatStore(
      useShallow((s) => ({
        operations: s.operations,
        operationsByContext: s.operationsByContext,
        operationsByMessage: s.operationsByMessage,
        toolCallingStreamIds: s.toolCallingStreamIds,
      })),
    );

  // Check if AI is generating in this context
  const isAIGenerating = useChatStore((s) =>
    operationSelectors.isAgentRuntimeRunningByContext(context)(s),
  );

  // Get send message error for this context
  const sendMessageError = useMemo(() => {
    const operationIds = operationsByContext[contextKey] || [];

    // Find the latest sendMessage operation with error
    for (const opId of [...operationIds].reverse()) {
      const op = operations[opId];
      if (op && op.type === 'sendMessage' && op.metadata.inputSendErrorMsg) {
        return op.metadata.inputSendErrorMsg as string;
      }
    }

    return undefined;
  }, [operationsByContext, contextKey, operations]);

  // Build the OperationState object
  const operationState = useMemo<OperationState>(() => {
    return {
      getMessageOperationState: (messageId: string) => {
        const state = useChatStore.getState();
        const operationIds = operationsByMessage[messageId] || [];

        if (operationIds.length === 0) {
          return DEFAULT_MESSAGE_OPERATION_STATE;
        }

        const messageOps = operationIds.map((id) => operations[id]).filter(Boolean);
        const runningOps = messageOps.filter((op) => op.status === 'running');

        return {
          isContinuing: runningOps.some((op) => op.type === 'continue'),
          isCreating: runningOps.some(
            (op) => op.type === 'sendMessage' || op.type === 'createAssistantMessage',
          ),
          // Check AI runtime operations (client-side and server-side)
          isGenerating: runningOps.some((op) => AI_RUNTIME_OPERATION_TYPES.includes(op.type)),
          isInReasoning: runningOps.some((op) => op.type === 'reasoning'),
          isProcessing: operationSelectors.isMessageProcessing(messageId)(state),
          isRegenerating: runningOps.some((op) => op.type === 'regenerate'),
        };
      },

      getToolOperationState: (messageId: string, index: number, _toolCallId?: string) => {
        const state = useChatStore.getState();

        // Check tool streaming state
        const toolStreamState = toolCallingStreamIds[messageId];
        const isStreaming = toolStreamState ? (toolStreamState[index] ?? false) : false;

        // Check tool invoking state (plugin API invocation)
        const isInvoking = operationSelectors.isMessageInToolCalling(messageId)(state);

        if (!isStreaming && !isInvoking) {
          return DEFAULT_TOOL_OPERATION_STATE;
        }

        return {
          isInvoking,
          isStreaming,
        };
      },
      isAIGenerating,
      sendMessageError,
    };
  }, [operations, operationsByMessage, toolCallingStreamIds, isAIGenerating, sendMessageError]);

  return operationState;
};

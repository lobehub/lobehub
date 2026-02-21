import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import { type State } from '../../initialState';
import { dataSelectors } from '../data/selectors';

/**
 * Check if a message is currently collapsed (from message metadata)
 */
const isMessageCollapsed = (id: string) => (s: State) => {
  const message = s.dbMessages.find((m) => m.id === id);
  return message?.metadata?.collapsed ?? false;
};

/**
 * Check if a message is currently being edited
 */
const isMessageEditing = (id: string) => (s: State) => s.messageEditingIds.includes(id);

/**
 * Check if a message is currently loading
 */
const isMessageLoading = (id: string) => (s: State) => s.messageLoadingIds.includes(id);

/**
 * Get all message IDs currently being edited
 */
const messageEditingIds = (s: State) => s.messageEditingIds;

/**
 * Get all message IDs currently loading
 */
const messageLoadingIds = (s: State) => s.messageLoadingIds;

// ===== Operation-based selectors (read from external operationState) =====
// Note: These selectors read from operationState which is passed externally from ChatStore.
// This ensures proper React reactivity while keeping operations global.

/**
 * Check if AI is generating in the current conversation context
 */
const isAIGenerating = (s: State) => s.operationState.isAIGenerating;

/**
 * Get send message error for this context (if any)
 */
const sendMessageError = (s: State) => s.operationState.sendMessageError;

/**
 * Check if a message is being created (sendMessage or createAssistantMessage)
 */
const isMessageCreating = (id: string) => (s: State) =>
  s.operationState.getMessageOperationState(id).isCreating;

/**
 * Check if a message is being generated (streaming response)
 */
const isMessageGenerating = (id: string) => (s: State) =>
  s.operationState.getMessageOperationState(id).isGenerating;

/**
 * Check if a message is being regenerated
 */
const isMessageRegenerating = (id: string) => (s: State) =>
  s.operationState.getMessageOperationState(id).isRegenerating;

/**
 * Check if a message is continuing generation
 */
const isMessageContinuing = (id: string) => (s: State) =>
  s.operationState.getMessageOperationState(id).isContinuing;

/**
 * Check if a message is in reasoning state
 */
const isMessageInReasoning = (id: string) => (s: State) =>
  s.operationState.getMessageOperationState(id).isInReasoning;

/**
 * Check if a message is processing (any operation)
 */
const isMessageProcessing = (id: string) => (s: State) =>
  s.operationState.getMessageOperationState(id).isProcessing;

// ===== Tool-related selectors (read from external operationState) =====

/**
 * Check if plugin API is currently invoking
 */
const isPluginApiInvoking = (id: string) => (s: State) =>
  s.operationState.getToolOperationState(id, 0).isInvoking;

/**
 * Check if a tool call is currently streaming
 */
const isToolCallStreaming = (id: string, index: number) => (s: State) =>
  s.operationState.getToolOperationState(id, index).isStreaming;

/**
 * Check if tool API name should be shining (streaming or invoking)
 */
const isToolApiNameShining =
  (messageId: string, index: number, toolCallId: string) => (s: State) => {
    const toolMessage = dataSelectors.getDbMessageByToolCallId(toolCallId)(s);
    const toolMessageId = toolMessage?.id;
    const toolState = s.operationState.getToolOperationState(messageId, index, toolCallId);
    const isStreaming = toolState.isStreaming;
    const isInvoking = !toolMessageId
      ? true
      : s.operationState.getToolOperationState(toolMessageId, 0).isInvoking;

    return isStreaming || isInvoking;
  };

// ===== Thread-related selectors (still bridge from ChatStore) =====
// Note: Thread state is global and not part of operation state.

/**
 * Check if a message has a thread by source message ID
 * This is a bridge selector that reads from global ChatStore
 */

const hasThreadBySourceMsgId = (id: string) => (_s: State) => {
  const chatState = useChatStore.getState();
  return threadSelectors.hasThreadBySourceMsgId(id)(chatState);
};

/**
 * Check if we are in thread mode (has active thread ID)
 * This is a bridge selector that reads from global ChatStore
 */

const isThreadMode = (_s: State) => {
  const chatState = useChatStore.getState();
  return !!chatState.activeThreadId;
};

export const messageStateSelectors = {
  hasThreadBySourceMsgId,
  isAIGenerating,
  isMessageCollapsed,
  isMessageContinuing,
  isMessageCreating,
  isMessageEditing,
  isMessageGenerating,
  isMessageInReasoning,
  isMessageLoading,
  isMessageProcessing,
  isMessageRegenerating,
  isPluginApiInvoking,
  isThreadMode,
  isToolApiNameShining,
  isToolCallStreaming,
  messageEditingIds,
  messageLoadingIds,
  sendMessageError,
};

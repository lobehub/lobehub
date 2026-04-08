import { type ChatStoreState } from '../../../initialState';
import { operationSelectors } from '../../operation/selectors';
import { getDbMessageByToolCallId } from './dbMessage';
import { getDisplayMessageById } from './displayMessage';

const isMessageEditing = (id: string) => (s: ChatStoreState) => s.messageEditingIds.includes(id);

/**
 * Check if a message is in loading state via the operation system
 */
const isMessageLoading = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageProcessing(id)(s);

// Use operation system for AI-related loading states
const isMessageRegenerating = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageRegenerating(id)(s);
const isMessageContinuing = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageContinuing(id)(s);
const isMessageGenerating = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageGenerating(id)(s); // Only check generateAI operations
const isMessageInChatReasoning = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageInReasoning(id)(s);

// Use operation system for message CRUD operations
const isMessageCreating = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageCreating(id)(s); // Only check sendMessage operations

const isMessageCollapsed = (id: string) => (s: ChatStoreState) => {
  const message = getDisplayMessageById(id)(s);
  return message?.metadata?.collapsed ?? false;
};

// Use operation system for plugin API invocation
const isPluginApiInvoking = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageInToolCalling(id)(s);

const isToolCallStreaming = (id: string, index: number) => (s: ChatStoreState) => {
  const isLoading = s.toolCallingStreamIds[id];

  if (!isLoading) return false;

  return isLoading[index];
};

const isInToolsCalling = (id: string, index: number) => (s: ChatStoreState) => {
  const isStreamingToolsCalling = isToolCallStreaming(id, index)(s);

  // Check if assistant message has any tool calling operations
  const isInvokingPluginApi = operationSelectors.isMessageInToolCalling(id)(s);

  return isStreamingToolsCalling || isInvokingPluginApi;
};

const isToolApiNameShining =
  (messageId: string, index: number, toolCallId: string) => (s: ChatStoreState) => {
    const toolMessageId = getDbMessageByToolCallId(toolCallId)(s)?.id;
    const isStreaming = isToolCallStreaming(messageId, index)(s);
    const isPluginInvoking = !toolMessageId ? true : isPluginApiInvoking(toolMessageId)(s);

    return isStreaming || isPluginInvoking;
  };

const isCreatingMessage = (s: ChatStoreState) => s.isCreatingMessage;

export const messageStateSelectors = {
  isCreatingMessage,
  isInToolsCalling,
  isMessageCollapsed,
  isMessageContinuing,
  isMessageCreating,
  isMessageEditing,
  isMessageGenerating,
  isMessageInChatReasoning,
  isMessageLoading,
  isMessageRegenerating,
  isPluginApiInvoking,
  isToolApiNameShining,
  isToolCallStreaming,
};

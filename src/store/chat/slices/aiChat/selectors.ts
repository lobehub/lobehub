import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type ChatStoreState } from '../../initialState';
import { operationSelectors } from '../operation/selectors';

const isMessageInReasoning = (id: string) => (s: ChatStoreState) =>
  operationSelectors.isMessageInReasoning(id)(s);

const isMessageInSearchWorkflow = (id: string) => (s: ChatStoreState) =>
  s.searchWorkflowLoadingIds.includes(id);

const isIntentUnderstanding = (id: string) => (s: ChatStoreState) =>
  isMessageInSearchWorkflow(id)(s);

const isCurrentSendMessageLoading = (s: ChatStoreState) => {
  const contextKey = messageMapKey({ agentId: s.activeAgentId, topicId: s.activeTopicId });
  const operationIds = s.operationsByContext[contextKey] || [];

  // Check if there's any running sendMessage operation
  return operationIds.some((opId) => {
    const op = s.operations[opId];
    return op && op.type === 'sendMessage' && op.status === 'running';
  });
};

const isCurrentSendMessageError = (s: ChatStoreState) => {
  const contextKey = messageMapKey({ agentId: s.activeAgentId, topicId: s.activeTopicId });
  const operationIds = s.operationsByContext[contextKey] || [];

  // Find the latest sendMessage operation with error
  for (const opId of [...operationIds].reverse()) {
    const op = s.operations[opId];
    if (op && op.type === 'sendMessage' && op.metadata.inputSendErrorMsg) {
      return op.metadata.inputSendErrorMsg;
    }
  }

  return undefined;
};

const isSendMessageLoadingForTopic = (topicKey: string) => (s: ChatStoreState) => {
  const operationIds = s.operationsByContext[topicKey] || [];

  // Check if there's any running sendMessage operation for this topic
  return operationIds.some((opId) => {
    const op = s.operations[opId];
    return op && op.type === 'sendMessage' && op.status === 'running';
  });
};

export const aiChatSelectors = {
  isCurrentSendMessageError,
  isCurrentSendMessageLoading,
  isIntentUnderstanding,
  isMessageInReasoning,
  isMessageInSearchWorkflow,
  isSendMessageLoadingForTopic,
};

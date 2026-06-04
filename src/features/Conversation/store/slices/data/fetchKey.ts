import { type ConversationContext } from '@lobechat/types';

export const conversationFetchMessagesKey = (context: ConversationContext) => {
  const keyContext: ConversationContext = {
    agentId: context.agentId,
    threadId: context.threadId ?? null,
    topicId: context.topicId ?? null,
  };

  if (context.defaultTaskAssigneeAgentId !== undefined) {
    keyContext.defaultTaskAssigneeAgentId = context.defaultTaskAssigneeAgentId;
  }
  if (context.documentId !== undefined) keyContext.documentId = context.documentId;
  if (context.groupId !== undefined) keyContext.groupId = context.groupId;
  if (context.isNew !== undefined) keyContext.isNew = context.isNew;
  if (context.isolatedTopic !== undefined) keyContext.isolatedTopic = context.isolatedTopic;
  if (context.isSupervisor !== undefined) keyContext.isSupervisor = context.isSupervisor;
  if (context.scope !== undefined) keyContext.scope = context.scope;
  if (context.sessionId !== undefined) keyContext.sessionId = context.sessionId;
  if (context.sourceMessageId !== undefined) keyContext.sourceMessageId = context.sourceMessageId;
  if (context.subAgentId !== undefined) keyContext.subAgentId = context.subAgentId;
  if (context.threadType !== undefined) keyContext.threadType = context.threadType;
  if (context.topicShareId !== undefined) keyContext.topicShareId = context.topicShareId;
  if (context.viewedTask !== undefined) keyContext.viewedTask = context.viewedTask;

  return ['CONVERSATION_FETCH_MESSAGES', keyContext] as const;
};

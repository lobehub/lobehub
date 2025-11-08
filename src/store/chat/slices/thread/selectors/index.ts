import { THREAD_DRAFT_ID } from '@lobechat/const';
import { ThreadItem, UIChatMessage } from '@lobechat/types';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import type { ChatStoreState } from '@/store/chat';
import { chatHelpers } from '@/store/chat/helpers';

import { chatSelectors } from '../../message/selectors';
import { genMessage } from './util';

const currentTopicThreads = (s: ChatStoreState) => {
  if (!s.activeTopicId) return [];

  return s.threadMaps[s.activeTopicId] || [];
};

const currentPortalThread = (s: ChatStoreState): ThreadItem | undefined => {
  if (!s.portalThreadId) return undefined;

  const threads = currentTopicThreads(s);

  return threads.find((t) => t.id === s.portalThreadId);
};

const threadStartMessageId = (s: ChatStoreState) => s.threadStartMessageId;

const threadSourceMessageId = (s: ChatStoreState) => {
  if (s.startToForkThread) return threadStartMessageId(s);

  const portalThread = currentPortalThread(s);
  return portalThread?.sourceMessageId;
};

const getTheadParentMessages = (s: ChatStoreState, data: UIChatMessage[]) => {
  if (s.startToForkThread) {
    const startMessageId = threadStartMessageId(s)!;

    // 存在 threadId 的消息是子消息，在创建付消息时需要忽略
    const messages = data.filter((m) => !m.threadId);
    return genMessage(messages, startMessageId, s.newThreadMode);
  }

  const portalThread = currentPortalThread(s);
  return genMessage(data, portalThread?.sourceMessageId, portalThread?.type);
};

// ======= Portal Thread Display Chats ======= //
// =========================================== //

/**
 * 获取当前 thread 的父级消息
 */
const portalDisplayParentMessages = (s: ChatStoreState): UIChatMessage[] => {
  const data = chatSelectors.activeBaseChatsWithoutTool(s);

  return getTheadParentMessages(s, data);
};

/**
 * these messages are the messages that are in the thread
 *
 */
const portalDisplayChildChatsByThreadId =
  (id?: string) =>
  (s: ChatStoreState): UIChatMessage[] => {
    // skip tool message
    const data = chatSelectors.activeBaseChatsWithoutTool(s);

    return data.filter((m) => !!id && m.threadId === id);
  };

const portalDisplayChats = (s: ChatStoreState) => {
  const parentMessages = portalDisplayParentMessages(s);
  const afterMessages = portalDisplayChildChatsByThreadId(s.portalThreadId)(s);
  // use for optimistic update
  const draftMessage = chatSelectors.activeBaseChats(s).find((m) => m.threadId === THREAD_DRAFT_ID);

  return [...parentMessages, draftMessage, ...afterMessages].filter(Boolean) as UIChatMessage[];
};

const portalDisplayChatsLength = (s: ChatStoreState) => {
  // history length include a thread divider
  return portalDisplayChats(s).length;
};
const portalDisplayChatsString = (s: ChatStoreState) => {
  const messages = portalDisplayChats(s);

  return messages.map((m) => m.content).join('');
};

const portalDisplayChatIDs = (s: ChatStoreState): string[] =>
  portalDisplayChats(s).map((i) => i.id);

// ========= Portal Thread AI Chats ========= //
// ========================================== //

const portalAIParentMessages = (s: ChatStoreState): UIChatMessage[] => {
  const data = chatSelectors.activeBaseChats(s);

  return getTheadParentMessages(s, data);
};

const portalAIChildChatsByThreadId =
  (id?: string) =>
  (s: ChatStoreState): UIChatMessage[] => {
    // skip tool message
    const data = chatSelectors.activeBaseChats(s);

    return data.filter((m) => !!id && m.threadId === id);
  };

const portalAIChats = (s: ChatStoreState) => {
  const parentMessages = portalAIParentMessages(s);
  const afterMessages = portalAIChildChatsByThreadId(s.portalThreadId)(s);

  return [...parentMessages, ...afterMessages].filter(Boolean) as UIChatMessage[];
};

const portalAIChatsWithHistoryConfig = (s: ChatStoreState) => {
  const parentMessages = portalAIParentMessages(s);
  const afterMessages = portalAIChildChatsByThreadId(s.portalThreadId)(s);

  const messages = [...parentMessages, ...afterMessages].filter(Boolean) as UIChatMessage[];

  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(useAgentStore.getState());
  const historyCount = agentChatConfigSelectors.historyCount(useAgentStore.getState());

  return chatHelpers.getSlicedMessages(messages, {
    enableHistoryCount,
    historyCount,
  });
};

const threadSourceMessageIndex = (s: ChatStoreState) => {
  const theadMessageId = threadSourceMessageId(s);
  const data = portalDisplayChats(s);

  return !theadMessageId ? -1 : data.findIndex((d) => d.id === theadMessageId);
};
const getThreadsByTopic = (topicId?: string) => (s: ChatStoreState) => {
  if (!topicId) return;

  return s.threadMaps[topicId];
};

const getFirstThreadBySourceMsgId = (id: string) => (s: ChatStoreState) => {
  const threads = currentTopicThreads(s);

  return threads.find((t) => t.sourceMessageId === id);
};

const getThreadsBySourceMsgId = (id: string) => (s: ChatStoreState) => {
  const threads = currentTopicThreads(s);

  return threads.filter((t) => t.sourceMessageId === id);
};

const hasThreadBySourceMsgId = (id: string) => (s: ChatStoreState) => {
  const threads = currentTopicThreads(s);

  return threads.some((t) => t.sourceMessageId === id);
};

const isThreadAIGenerating = (s: ChatStoreState) =>
  s.chatLoadingIds.some((id) => portalDisplayChatIDs(s).includes(id));

const isInRAGFlow = (s: ChatStoreState) =>
  s.messageRAGLoadingIds.some((id) => portalDisplayChatIDs(s).includes(id));
const isCreatingMessage = (s: ChatStoreState) => s.isCreatingThreadMessage;
const isHasMessageLoading = (s: ChatStoreState) =>
  s.messageLoadingIds.some((id) => portalDisplayChatIDs(s).includes(id));

/**
 * this function is used to determine whether the send button should be disabled
 */
const isSendButtonDisabledByMessage = (s: ChatStoreState) =>
  // 1. when there is message loading
  isHasMessageLoading(s) ||
  // 2. when is creating the topic
  s.isCreatingThread ||
  // 3. when is creating the message
  isCreatingMessage(s) ||
  // 4. when the message is in RAG flow
  isInRAGFlow(s);

export const threadSelectors = {
  currentPortalThread,
  currentTopicThreads,
  getFirstThreadBySourceMsgId,
  getThreadsBySourceMsgId,
  getThreadsByTopic,
  hasThreadBySourceMsgId,
  isSendButtonDisabledByMessage,
  isThreadAIGenerating,
  portalAIChats,
  portalAIChatsWithHistoryConfig,
  portalDisplayChatIDs,
  portalDisplayChats,
  portalDisplayChatsLength,
  portalDisplayChatsString,
  portalDisplayChildChatsByThreadId,
  threadSourceMessageId,
  threadSourceMessageIndex,
  threadStartMessageId,
};

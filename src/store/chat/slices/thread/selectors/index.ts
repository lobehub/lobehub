import { type ThreadItem, type UIChatMessage } from '@lobechat/types';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { type ChatStoreState } from '@/store/chat';
import { chatHelpers } from '@/store/chat/helpers';

import { displayMessageSelectors } from '../../message/selectors';
import { genParentMessages } from './util';

// ============= Thread List Selectors ============= //

const currentTopicThreads = (s: ChatStoreState) => {
  if (!s.activeTopicId) return [];

  return s.threadMaps[s.activeTopicId] || [];
};

const currentPortalThread = (s: ChatStoreState): ThreadItem | undefined => {
  if (!s.portalThreadId) return undefined;

  const threads = currentTopicThreads(s);

  return threads.find((t) => t.id === s.portalThreadId);
};

const getThreadsByTopic = (topicId?: string) => (s: ChatStoreState) => {
  if (!topicId) return;

  return s.threadMaps[topicId];
};

const getThreadsBySourceMsgId = (id: string) => (s: ChatStoreState) => {
  const threads = currentTopicThreads(s);

  return threads.filter((t) => t.sourceMessageId === id);
};

const hasThreadBySourceMsgId = (id: string) => (s: ChatStoreState) => {
  const threads = currentTopicThreads(s);

  return threads.some((t) => t.sourceMessageId === id);
};

// ============= Thread Messages Selectors ============= //
// These are kept for Token calculation and AI title summarization
// Thread Chat component now uses dbMessagesMap directly

/**
 * Internal helper to get parent messages for a thread
 */
const getThreadParentMessages = (s: ChatStoreState, data: UIChatMessage[]) => {
  if (s.startToForkThread) {
    const startMessageId = s.threadStartMessageId!;

    // Filter out messages that belong to other threads
    const messages = data.filter((m) => !m.threadId);
    return genParentMessages(messages, startMessageId, s.newThreadMode);
  }

  const portalThread = currentPortalThread(s);
  return genParentMessages(data, portalThread?.sourceMessageId, portalThread?.type);
};

/**
 * Get thread child messages by thread ID
 */
const getThreadChildMessages =
  (id?: string) =>
  (s: ChatStoreState): UIChatMessage[] => {
    const data = displayMessageSelectors.activeDisplayMessages(s);
    return data.filter((m) => !!id && m.threadId === id);
  };

/**
 * Portal AI chats - used for AI title summarization
 */
const portalAIChats = (s: ChatStoreState) => {
  const data = displayMessageSelectors.activeDisplayMessages(s);
  const parentMessages = getThreadParentMessages(s, data);
  const childMessages = getThreadChildMessages(s.portalThreadId)(s);

  return [...parentMessages, ...childMessages].filter(Boolean) as UIChatMessage[];
};

/**
 * Portal AI chats with history config - used for workflow
 */
const portalAIChatsWithHistoryConfig = (s: ChatStoreState) => {
  const messages = portalAIChats(s);

  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(useAgentStore.getState());
  const historyCount = agentChatConfigSelectors.historyCount(useAgentStore.getState());

  return chatHelpers.getSlicedMessages(messages, {
    enableHistoryCount,
    historyCount,
  });
};

/**
 * Portal display chats string - used for Token calculation
 */
const portalDisplayChatsString = (s: ChatStoreState) => {
  const messages = portalAIChats(s);
  return messages.map((m) => m.content).join('');
};

export const threadSelectors = {
  currentPortalThread,
  currentTopicThreads,
  getThreadsBySourceMsgId,
  getThreadsByTopic,
  hasThreadBySourceMsgId,
  portalAIChats,
  portalAIChatsWithHistoryConfig,
  portalDisplayChatsString,
};

// Re-export utility function for use in action.ts
export { genParentMessages } from './util';

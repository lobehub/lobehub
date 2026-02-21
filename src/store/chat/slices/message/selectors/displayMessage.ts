import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';

import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';

import { chatHelpers } from '../../../helpers';
import { type ChatStoreState } from '../../../initialState';
import { messageMapKey } from '../../../utils/messageMapKey';

/**
 * Display Message Selectors
 *
 * These selectors access processed messages from messagesMap (parsed display data).
 * Use these selectors when you need to:
 * - Render messages in UI components
 * - Display assistantGroup messages with children
 * - Present message history with filters
 *
 * DO NOT use these for data mutations - use dbMessage.ts selectors instead.
 */

// ============= Basic Display Message Access ========== //

/**
 * Get the current chat key for accessing messagesMap
 * For group conversations, uses groupId to generate the correct key
 */
export const currentDisplayChatKey = (s: ChatStoreState) =>
  messageMapKey({
    agentId: s.activeAgentId,
    groupId: s.activeGroupId,
    threadId: s.activeThreadId,
    topicId: s.activeTopicId,
  });

/**
 * Get display messages by key
 */
const getDisplayMessagesByKey =
  (key: string) =>
  (s: ChatStoreState): UIChatMessage[] => {
    return s.messagesMap[key] || [];
  };

/**
 * Get current active agent's display messages (includes assistantGroup messages)
 */
const activeDisplayMessages = (s: ChatStoreState): UIChatMessage[] => {
  if (!s.activeAgentId) return [];
  return getDisplayMessagesByKey(currentDisplayChatKey(s))(s);
};

// ============= Display Message Queries ========== //

/**
 * Get display message by ID (searches in messagesMap including assistantGroup children)
 */
export const getDisplayMessageById = (id: string) => (s: ChatStoreState) =>
  chatHelpers.getMessageById(activeDisplayMessages(s), id);

const lastDisplayMessageId = (s: ChatStoreState) => {
  const messages = activeDisplayMessages(s);
  if (messages.length === 0) return undefined;
  return messages.at(-1)?.id;
};

// ============= Thread Handling ========== //

const getChatsWithThread = (s: ChatStoreState, messages: UIChatMessage[]) => {
  // 如果没有 activeThreadId，则返回所有的主消息
  if (!s.activeThreadId) return messages.filter((m) => !m.threadId);

  const thread = s.threadMaps[s.activeTopicId!]?.find((t) => t.id === s.activeThreadId);

  if (!thread) return messages.filter((m) => !m.threadId);

  const sourceIndex = messages.findIndex((m) => m.id === thread.sourceMessageId);
  const sliced = messages.slice(0, sourceIndex + 1);

  return [...sliced, ...messages.filter((m) => m.threadId === s.activeThreadId)];
};

// ============= Main Display Chats ========== //

/**
 * Main display chats for UI rendering (without tool messages, with thread handling)
 */
const mainDisplayChats = (s: ChatStoreState): UIChatMessage[] => {
  const displayChats = activeDisplayMessages(s);
  return getChatsWithThread(s, displayChats);
};

/**
 * Main display chat IDs
 */
const mainDisplayChatIDs = (s: ChatStoreState) => mainDisplayChats(s).map((s) => s.id);

/**
 * Main AI chats (includes tool messages, with thread handling)
 */
const mainAIChats = (s: ChatStoreState): UIChatMessage[] => {
  const messages = activeDisplayMessages(s);
  return getChatsWithThread(s, messages);
};

/**
 * Main AI chats with history configuration applied
 */
const mainAIChatsWithHistoryConfig = (s: ChatStoreState): UIChatMessage[] => {
  const chats = mainAIChats(s);
  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(useAgentStore.getState());
  const historyCount = agentChatConfigSelectors.historyCount(useAgentStore.getState());

  return chatHelpers.getSlicedMessages(chats, {
    enableHistoryCount,
    historyCount,
  });
};

/**
 * Concatenated message string from AI chats with history config
 */
const mainAIChatsMessageString = (s: ChatStoreState): string => {
  const chats = mainAIChatsWithHistoryConfig(s);
  return chats.map((m) => m.content).join('');
};

/**
 * Latest message reasoning content
 */
const mainAILatestMessageReasoningContent = (s: ChatStoreState) =>
  mainAIChats(s).at(-1)?.reasoning?.content;

// ============= Display Message Status ========== //

/**
 * Check if current chat messages are loaded
 */
const currentChatLoadingState = (s: ChatStoreState) => !s.messagesInit;

/**
 * Check if current chat is loaded in messagesMap
 */
const isCurrentDisplayChatLoaded = (s: ChatStoreState) => !!s.messagesMap[currentDisplayChatKey(s)];

/**
 * Show inbox welcome screen
 */
const showInboxWelcome = (s: ChatStoreState): boolean => {
  const isInbox = s.activeAgentId === INBOX_SESSION_ID;
  if (!isInbox) return false;

  const data = activeDisplayMessages(s);
  return data.length === 0;
};

// ============= Thread Messages ========== //

/**
 * Gets messages between the current user and a specific agent (thread messages)
 * This is like a DM (Direct Message) view between user and agent
 */
const getThreadMessages =
  (agentId: string) =>
  (s: ChatStoreState): UIChatMessage[] => {
    if (!agentId) return [];

    const allMessages = activeDisplayMessages(s);

    // Filter messages to only include:
    // 1. User messages sent TO the specific agent (role: 'user' && targetId matches agentId)
    // 2. Assistant messages FROM the specific agent sent TO user (role: 'assistant' && agentId matches && targetId is 'user')
    return allMessages.filter((message) => {
      if (message.role === 'user' && message.targetId === agentId) {
        return true; // Include user messages sent to the specific agent
      }

      if (
        message.role === 'assistant' &&
        message.agentId === agentId &&
        message.targetId === 'user'
      ) {
        return true; // Include messages from the specific agent sent to user
      }

      return false; // Exclude all other messages
    });
  };

/**
 * Gets thread message IDs for a specific agent
 */
const getThreadMessageIDs =
  (agentId: string) =>
  (s: ChatStoreState): string[] => {
    return getThreadMessages(agentId)(s).map((message) => message.id);
  };

// ============= Group Chat Selectors ========== //

/**
 * Gets the latest message block from a group message that doesn't contain tools
 * Returns null if the last block contains tools or if message is not a group message
 */
const getGroupLatestMessageWithoutTools = (id: string) => (s: ChatStoreState) => {
  const message = getDisplayMessageById(id)(s);

  if (
    !message ||
    message.role !== 'assistantGroup' ||
    !message.children ||
    message.children.length === 0
  )
    return;

  // Get the last child
  const lastChild = message.children.at(-1);

  if (!lastChild) return;

  // Return the last child only if it doesn't have tools
  if (!lastChild.tools || lastChild.tools.length === 0) {
    if (!lastChild.content) return;

    return lastChild;
  }

  return;
};

/**
 * Helper to find last message ID in an AssistantContentBlock
 */
const findLastBlockId = (block: AssistantContentBlock | undefined): string | undefined => {
  if (!block) return undefined;

  // Check tools for result message ID
  if (block.tools && block.tools.length > 0) {
    const lastTool = block.tools.at(-1);
    return lastTool?.result_msg_id;
  }

  // Return block ID
  return block.id;
};

/**
 * Recursively finds the last message ID in a message tree
 * Priority: children > tools > compressedGroup.lastMessageId > self
 */
const findLastMessageIdRecursive = (node: UIChatMessage | undefined): string | undefined => {
  if (!node) return undefined;

  // Priority 1: Dive into children recursively
  if (node.children && node.children.length > 0) {
    const lastChild = node.children.at(-1);
    return findLastBlockId(lastChild);
  }

  // Priority 2: Check tools for result message ID
  if (node.tools && node.tools.length > 0) {
    const lastTool = node.tools.at(-1);
    return lastTool?.result_msg_id;
  }

  // Priority 3: For compressedGroup, return lastMessageId instead of group ID
  if (node.role === 'compressedGroup' && 'lastMessageId' in node) {
    return (node as any).lastMessageId;
  }

  // Priority 4: Return self ID
  return node.id;
};

/**
 * Finds the last (deepest) message ID from a display message
 * Recursively traverses children and tools to find the actual last message
 */
const findLastMessageId = (id: string) => (s: ChatStoreState) => {
  const message = getDisplayMessageById(id)(s);
  return findLastMessageIdRecursive(message);
};

// ============= Inbox Selectors ========== //

/**
 * Get inbox active topic display messages
 */
const inboxActiveTopicDisplayMessages = (state: ChatStoreState) => {
  const activeTopicId = state.activeTopicId;
  const key = messageMapKey({ agentId: INBOX_SESSION_ID, topicId: activeTopicId });
  return state.messagesMap[key] || [];
};

export const displayMessageSelectors = {
  activeDisplayMessages,
  currentChatLoadingState,
  currentDisplayChatKey,
  findLastMessageId,
  getDisplayMessageById,
  getDisplayMessagesByKey,
  getGroupLatestMessageWithoutTools,
  getThreadMessageIDs,
  getThreadMessages,
  inboxActiveTopicDisplayMessages,
  isCurrentDisplayChatLoaded,
  lastDisplayMessageId,
  mainAIChats,
  mainAIChatsMessageString,
  mainAIChatsWithHistoryConfig,
  mainAILatestMessageReasoningContent,
  mainDisplayChatIDs,
  mainDisplayChats,
  showInboxWelcome,
};

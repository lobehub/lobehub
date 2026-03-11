import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { type State } from '../../initialState';

const displayMessages = (s: State) => s.displayMessages;
const displayMessageIds = (s: State) => s.displayMessages.map((m) => m.id);
const dbMessages = (s: State) => s.dbMessages;
const messagesInit = (s: State) => s.messagesInit;
const skipFetch = (s: State) => s.skipFetch;

const getDisplayMessageById = (id: string) => (s: State) => {
  // First, try to find in top-level displayMessages
  const topLevelMessage = s.displayMessages.find((m) => m.id === id);
  if (topLevelMessage) return topLevelMessage;

  // If not found, search in agentCouncil members
  for (const message of s.displayMessages) {
    if (message.role === 'agentCouncil' && (message as any).members) {
      const member = (message as any).members.find((m: UIChatMessage) => m.id === id);
      if (member) return member;
    }
  }

  return undefined;
};
const getDbMessageById = (id: string) => (s: State) => s.dbMessages.find((m) => m.id === id);
const getDbMessageByToolCallId = (id: string) => (s: State) =>
  s.dbMessages.find((m) => m.tool_call_id === id);

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
 * Priority: children > tools > self
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

  // Priority 3: Return self ID
  return node.id;
};

/**
 * Finds the last (deepest) message ID from a display message
 * Recursively traverses children and tools to find the actual last message
 */
const findLastMessageId = (id: string) => (s: State) => {
  const message = getDisplayMessageById(id)(s);
  return findLastMessageIdRecursive(message);
};

/**
 * Gets the latest message block from a group message that doesn't contain tools
 * Returns undefined if the last block contains tools or if message is not a group message
 */
const getGroupLatestMessageWithoutTools = (id: string) => (s: State) => {
  const message = s.displayMessages.find((m) => m.id === id);

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

// ===== Topic-related selectors (bridged from ChatStore) =====

/**
 * Get the topic summary for current conversation
 * This is a bridge selector that reads from global ChatStore
 */
const currentTopicSummary = () => {
  const chatState = useChatStore.getState();
  return topicSelectors.currentActiveTopicSummary(chatState);
};

export const dataSelectors = {
  currentTopicSummary,
  dbMessages,
  displayMessageIds,
  displayMessages,
  findLastMessageId,
  getDbMessageById,
  getDbMessageByToolCallId,
  getDisplayMessageById,
  getGroupLatestMessageWithoutTools,
  messagesInit,
  skipFetch,
};

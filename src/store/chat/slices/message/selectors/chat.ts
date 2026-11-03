/**
 * Chat Selectors - Backward Compatibility Layer
 *
 * This file provides backward compatibility by re-exporting selectors from:
 * - dbMessage.ts: Raw database message selectors (for data operations)
 * - displayMessage.ts: Display message selectors (for UI rendering)
 *
 * MIGRATION GUIDE:
 * ================
 *
 * For Data Operations (create, update, delete):
 * ----------------------------------------------
 * Use dbMessageSelectors from './dbMessage'
 *
 * Before: chatSelectors.getMessageById(id)(state)
 * After:  dbMessageSelectors.getDbMessageById(id)(state)
 *
 * Before: chatSelectors.latestMessage(state)
 * After:  dbMessageSelectors.latestDbMessage(state)
 *
 * Before: chatSelectors.currentToolMessages(state)
 * After:  dbMessageSelectors.dbToolMessages(state)
 *
 * For UI Rendering:
 * -----------------
 * Use displayMessageSelectors from './displayMessage'
 *
 * Before: chatSelectors.mainDisplayChats(state)
 * After:  displayMessageSelectors.mainDisplayChats(state)
 *
 * Before: chatSelectors.getMessageById(id)(state)  // For display
 * After:  displayMessageSelectors.getDisplayMessageById(id)(state)
 */
import { type ChatFileItem } from '@lobechat/types';

import { type ChatStoreState } from '../../../initialState';
import { dbMessageSelectors } from './dbMessage';
import { displayMessageSelectors } from './displayMessage';

// Re-export new selector groups
export { dbMessageSelectors } from './dbMessage';
export { displayMessageSelectors } from './displayMessage';

// ============= Backward Compatibility Exports ========== //
// These maintain the old API for gradual migration
// Prefer using dbMessageSelectors or displayMessageSelectors directly

/**
 * @deprecated Use displayMessageSelectors.currentDisplayChatKey instead
 */
export const currentChatKey = displayMessageSelectors.currentDisplayChatKey;

/**
 * @deprecated Use displayMessageSelectors.mainDisplayChatIDs instead
 */
export const mainDisplayChatIDs = displayMessageSelectors.mainDisplayChatIDs;

/**
 * Legacy chatSelectors object for backward compatibility
 * @deprecated Import dbMessageSelectors or displayMessageSelectors directly
 */
export const chatSelectors = {
  // Display message selectors (from messagesMap)
  activeBaseChats: displayMessageSelectors.activeDisplayMessages,
  // DB message selectors (from dbMessagesMap)
  countMessagesByThreadId: dbMessageSelectors.countDbMessagesByThreadId,

  currentChatKey: displayMessageSelectors.currentDisplayChatKey,

  currentChatLoadingState: displayMessageSelectors.currentChatLoadingState,

  currentToolMessages: dbMessageSelectors.dbToolMessages,

  currentUserFiles: (s: ChatStoreState) =>
    dbMessageSelectors.dbUserFiles(s) as unknown as ChatFileItem[],

  getBaseChatsByKey: displayMessageSelectors.getDisplayMessagesByKey,

  getMessageById: displayMessageSelectors.getDisplayMessageById,

  getThreadMessageIDs: displayMessageSelectors.getThreadMessageIDs,

  getThreadMessages: displayMessageSelectors.getThreadMessages,

  getTraceIdByMessageId: dbMessageSelectors.getTraceIdByDbMessageId,

  inboxActiveTopicMessages: displayMessageSelectors.inboxActiveTopicDisplayMessages,

  isCurrentChatLoaded: displayMessageSelectors.isCurrentDisplayChatLoaded,

  latestMessage: dbMessageSelectors.latestDbMessage,

  mainAIChats: displayMessageSelectors.mainAIChats,

  mainAIChatsMessageString: displayMessageSelectors.mainAIChatsMessageString,

  mainAIChatsWithHistoryConfig: displayMessageSelectors.mainAIChatsWithHistoryConfig,
  mainAILatestMessageReasoningContent: displayMessageSelectors.mainAILatestMessageReasoningContent,
  mainDisplayChatIDs: displayMessageSelectors.mainDisplayChatIDs,
  mainDisplayChats: displayMessageSelectors.mainDisplayChats,
  showInboxWelcome: displayMessageSelectors.showInboxWelcome,
};

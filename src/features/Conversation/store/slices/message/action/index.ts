import type { StateCreator } from 'zustand';

import type { Store as ConversationStore } from '../../../action';
import { type MessageCRUDAction, messageCRUDSlice } from './crud';
import { sendMessage } from './sendMessage';
import { type MessageStateAction, messageStateSlice } from './state';

/**
 * Message Actions
 *
 * Handles all message operations:
 * - CRUD (create, read, update, delete)
 * - State management (loading, collapsed, editing)
 * - Sending messages
 */
export interface MessageAction extends MessageCRUDAction, MessageStateAction {
  /**
   * Add an AI message (convenience method)
   */
  addAIMessage: (content: string) => Promise<string | undefined>;

  /**
   * Add a user message (convenience method)
   */
  addUserMessage: (params: { fileList?: string[]; message: string }) => Promise<string | undefined>;

  /**
   * Send a message in this conversation (unified Main + Thread)
   */
  sendMessage: ReturnType<typeof sendMessage>;
}

export const messageSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  MessageAction
> = (set, get, ...rest) => ({
  // Spread CRUD actions
  ...messageCRUDSlice(set, get, ...rest),

  // Spread state actions
  ...messageStateSlice(set, get, ...rest),

  // Convenience methods
  addAIMessage: async (content: string) => {
    const state = get();
    const { context, hooks } = state;
    const { agentId, topicId, threadId } = context;

    // Get parent message ID
    const displayMessages = state.displayMessages;
    const parentId = displayMessages.length > 0 ? displayMessages.at(-1)?.id : undefined;

    const id = await state.createMessage({
      agentId: agentId,
      content,
      parentId,
      role: 'assistant',
      threadId: threadId ?? undefined,
      topicId: topicId ?? undefined,
    });

    if (id) {
      // ===== Hook: onMessageCreated =====
      if (hooks.onMessageCreated) {
        const message = state.displayMessages.find((m) => m.id === id);
        if (message) {
          hooks.onMessageCreated(message);
        }
      }

      // Clear input after successful creation
      set({ inputMessage: '' });
    }

    return id;
  },

  addUserMessage: async ({ message, fileList }) => {
    const state = get();
    const { context, hooks } = state;
    const { agentId, topicId, threadId } = context;

    // Get parent message ID
    const displayMessages = state.displayMessages;
    const parentId = displayMessages.length > 0 ? displayMessages.at(-1)?.id : undefined;

    const id = await state.createMessage({
      agentId,
      content: message,
      files: fileList,
      parentId,
      role: 'user',
      threadId: threadId ?? undefined,
      topicId: topicId ?? undefined,
    });

    if (id) {
      // ===== Hook: onMessageCreated =====
      if (hooks.onMessageCreated) {
        const createdMessage = state.displayMessages.find((m) => m.id === id);
        if (createdMessage) {
          hooks.onMessageCreated(createdMessage);
        }
      }

      // Clear input after successful creation
      set({ inputMessage: '' });
    }

    return id;
  },

  // Send message
  sendMessage: sendMessage(set, get),
});

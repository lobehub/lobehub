import { type SendMessageParams } from '@lobechat/types';

import { useChatStore } from '@/store/chat';

import { type Store as ConversationStore } from '../../../action';

/**
 * Send a message in this conversation
 *
 * This is a simplified wrapper that:
 * 1. Calls lifecycle hooks
 * 2. Forwards to ChatStore.sendMessage with context
 * 3. Passes displayMessages to decouple from store selectors
 *
 * All actual message sending logic lives in ChatStore.
 */
export const sendMessage = (
  set: (partial: Partial<ConversationStore>) => void,
  get: () => ConversationStore,
) => {
  return async (params: SendMessageParams) => {
    const state = get();
    const { context, hooks, displayMessages } = state;

    // ===== Hook: onBeforeSendMessage =====
    if (hooks.onBeforeSendMessage) {
      const result = await hooks.onBeforeSendMessage(params);
      if (result === false) {
        console.log('[ConversationStore] sendMessage blocked by onBeforeSendMessage hook');
        return;
      }
    }

    // Get global chat store
    const chatStore = useChatStore.getState();

    // Forward to ChatStore.sendMessage with context and messages
    // Pass displayMessages to decouple sendMessage from store selectors
    const result = await chatStore.sendMessage({
      ...params,
      context,
      messages: params.messages ?? displayMessages,
    });

    // ===== Hook: onAfterMessageCreate =====
    // Called after messages are created but before AI response is complete
    if (result && hooks.onAfterMessageCreate) {
      await hooks.onAfterMessageCreate({
        assistantMessageId: result.assistantMessageId,
        createdThreadId: result.createdThreadId,
        userMessageId: result.userMessageId,
      });
    }

    // ===== Hook: onAfterSendMessage =====
    if (hooks.onAfterSendMessage) {
      await hooks.onAfterSendMessage();
    }

    // Clear input message
    set({ inputMessage: '' });
  };
};

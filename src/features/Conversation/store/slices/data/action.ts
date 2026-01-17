import { parse } from '@lobechat/conversation-flow';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { messageService } from '@/services/message';

import type { Store as ConversationStore } from '../../action';
import { type MessageDispatch, messagesReducer } from './reducer';
import { dataSelectors } from './selectors';

/**
 * Data Actions
 *
 * Handles message fetching based on conversation context.
 */
export interface DataAction {
  /**
   * Dispatch message updates for optimistic UI updates
   * This method updates the frontend state without persisting to database
   */
  internal_dispatchMessage: (payload: MessageDispatch) => void;

  /**
   * Replace all messages with new data
   * Used for syncing after database operations (optimistic update pattern)
   *
   * @param messages - New messages array from database
   */
  replaceMessages: (messages: UIChatMessage[]) => void;

  /**
   * Switch message branch by updating the parent's activeBranchIndex
   *
   * @param messageId - The current message ID (with branch indicator)
   * @param branchIndex - The new branch index to switch to
   */
  switchMessageBranch: (messageId: string, branchIndex: number) => Promise<void>;

  /**
   * Fetch messages for this conversation using SWR
   *
   * @param context - Conversation context with sessionId and topicId
   * @param skipFetch - When true, SWR key is null and no fetch occurs
   */
  useFetchMessages: (
    context: ConversationContext,
    skipFetch?: boolean,
  ) => SWRResponse<UIChatMessage[]>;
}

export const dataSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  DataAction
> = (set, get) => ({
  internal_dispatchMessage: (payload) => {
    const dbMessages = get().dbMessages;

    // Apply array-based reducer - preserves message order
    const newDbMessages = messagesReducer(dbMessages, payload);

    // Check if anything changed
    if (newDbMessages === dbMessages) return;

    // Re-parse for display order and grouping
    const { flatList } = parse(newDbMessages);

    set({ dbMessages: newDbMessages, displayMessages: flatList }, false, {
      payload,
      type: `dispatchMessage/${payload.type}`,
    });

    // Sync changes to external store (ChatStore)
    get().onMessagesChange?.(newDbMessages, get().context);
  },

  replaceMessages: (messages) => {
    // Parse messages using conversation-flow
    const { flatList } = parse(messages);

    set({ dbMessages: messages, displayMessages: flatList }, false, 'replaceMessages');

    // Sync changes to external store (ChatStore)
    get().onMessagesChange?.(messages, get().context);
  },

  switchMessageBranch: async (messageId, branchIndex) => {
    const state = get();

    // Get the current message to find its parent
    const message = dataSelectors.getDbMessageById(messageId)(state);
    if (!message || !message.parentId) return;

    // Update the parent's metadata.activeBranchIndex
    // because the branch indicator is on the child message,
    // but the activeBranchIndex is stored on the parent
    await state.updateMessageMetadata(message.parentId, { activeBranchIndex: branchIndex });
  },

  useFetchMessages: (context, skipFetch) => {
    // When skipFetch is true, SWR key is null - no fetch occurs
    // This is used when external messages are provided (e.g., creating new thread)
    // Also skip fetch when topicId is null (new conversation state) - there's no server data,
    // only local optimistic updates. Fetching would return empty array and overwrite local data.
    const shouldFetch = !skipFetch && !!context.agentId && !!context.topicId;
    return useClientDataSWRWithSync<UIChatMessage[]>(
      shouldFetch ? ['CONVERSATION_FETCH_MESSAGES', context] : null,

      async () => {
        return messageService.getMessages(context);
      },
      {
        onData: (data) => {
          if (!data) return;
          if (!context.topicId) return;

          // Parse messages using conversation-flow
          const { flatList } = parse(data);

          set({
            dbMessages: data,
            displayMessages: flatList,
            messagesInit: true,
          });

          // Call onMessagesChange callback with the request context (not current context)
          // This ensures data is stored to the correct topic even if user switched topics
          get().onMessagesChange?.(data, context);
        },
      },
    );
  },
});

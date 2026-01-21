import { parse } from '@lobechat/conversation-flow';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';

import { type MessageMapKeyInput, messageMapKey } from '../../../utils/messageMapKey';

const SWR_USE_FETCH_MESSAGES = 'SWR_USE_FETCH_MESSAGES';

/**
 * Data query and synchronization actions
 * Handles fetching, refreshing, and replacing message data
 */
export interface MessageQueryAction {
  /**
   * Manually refresh messages from server
   */
  refreshMessages: (context?: Partial<ConversationContext>) => Promise<void>;

  /**
   * Replace current messages with new data
   */
  replaceMessages: (
    messages: UIChatMessage[],
    params?: {
      action?: any;
      /**
       * Conversation context for message storage key
       * If not provided, uses active context from state
       */
      context?: Partial<ConversationContext>;
      /**
       * Operation ID for context retrieval
       * @deprecated Use context instead
       */
      operationId?: string;
    },
  ) => void;

  /**
   * Fetch messages for a specific context using SWR
   * Used for fetching thread messages or messages for a specific context
   *
   * @param context - Conversation context with agentId, topicId, threadId, etc.
   * @param skipFetch - When true, SWR key is null and no fetch occurs
   */
  useFetchMessages: (
    context: ConversationContext,
    skipFetch?: boolean,
  ) => SWRResponse<UIChatMessage[]>;
}

export const messageQuery: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MessageQueryAction
> = (set, get) => ({
  // TODO: The mutate should only be called once, but since we haven't merge session and group,
  // we need to call it twice
  refreshMessages: async (context?: Partial<ConversationContext>) => {
    const agentId = context?.agentId ?? get().activeAgentId;
    const topicId = context?.topicId !== undefined ? context.topicId : get().activeTopicId;
    // TODO: Support threadId refresh when needed
    await mutate([SWR_USE_FETCH_MESSAGES, agentId, topicId, 'session']);
    await mutate([SWR_USE_FETCH_MESSAGES, agentId, topicId, 'group']);
  },

  replaceMessages: (messages, params) => {
    let ctx: MessageMapKeyInput;

    // Priority 1: Use explicit context if provided (preserving scope)
    if (params?.context) {
      ctx = {
        agentId: params.context.agentId ?? get().activeAgentId,
        // Preserve groupId from context
        groupId: params.context.groupId,
        // Preserve scope from context
        isNew: params.context.isNew,

        scope: params.context.scope,

        threadId: params.context.threadId,
        topicId:
          params.context.topicId !== undefined ? params.context.topicId : get().activeTopicId,
      };
    }
    // Priority 2: Get full context from operation if operationId is provided (deprecated)
    else if (params?.operationId) {
      ctx = get().internal_getConversationContext(params);
    }
    // Priority 3: Fallback to global state
    else {
      ctx = {
        agentId: get().activeAgentId,
        groupId: get().activeGroupId,
        threadId: get().activeThreadId,
        topicId: get().activeTopicId,
      };
    }

    const messagesKey = messageMapKey(ctx);

    // Get raw messages from dbMessagesMap and apply reducer
    const nextDbMap = { ...get().dbMessagesMap, [messagesKey]: messages };

    if (isEqual(nextDbMap, get().dbMessagesMap)) return;

    // Parse messages using conversation-flow
    const { flatList } = parse(messages);

    set(
      {
        // Store raw messages from backend
        dbMessagesMap: nextDbMap,
        // Store parsed messages for display
        messagesMap: { ...get().messagesMap, [messagesKey]: flatList },
      },
      false,
      params?.action ?? 'replaceMessages',
    );
  },

  useFetchMessages: (context, skipFetch) => {
    // Skip fetch when skipFetch is true or required fields are missing
    const shouldFetch = !skipFetch && !!context.agentId && !!context.topicId;

    return useClientDataSWRWithSync<UIChatMessage[]>(
      shouldFetch ? ['CHAT_STORE_FETCH_MESSAGES', context] : null,
      () => messageService.getMessages(context),
      {
        onData: (data) => {
          if (!data || !context.topicId) return;

          // Use replaceMessages to store the fetched messages
          get().replaceMessages(data, { action: 'useFetchMessages', context });
        },
      },
    );
  },
});

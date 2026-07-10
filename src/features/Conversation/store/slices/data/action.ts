import { parse } from '@lobechat/conversation-flow';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { messageKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { getChatStoreState } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type Store as ConversationStore } from '../../action';
import { type MessageDispatch } from './reducer';
import { messagesReducer } from './reducer';
import { dataSelectors } from './selectors';
import { stabilizeReferences } from './stabilizeReferences';

const log = debug('lobe-render:features:Conversation');

const mergeFetchedMessagesWithLocalState = (
  fetchedMessages: UIChatMessage[],
  localMessages: UIChatMessage[],
): UIChatMessage[] => {
  if (localMessages.length === 0 || fetchedMessages.length === 0) return fetchedMessages;

  const localById = new Map(localMessages.map((message) => [message.id, message]));
  let changed = false;

  const mergedMessages = fetchedMessages.map((message) => {
    const localMessage = localById.get(message.id);

    if (!localMessage) return message;
    if (localMessage.updatedAt <= message.updatedAt) return message;

    changed = true;
    return localMessage;
  });

  return changed ? mergedMessages : fetchedMessages;
};

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
   * Fetch messages for this conversation using SWR.
   *
   * @param context - Conversation context with sessionId and topicId
   * @param options.skipFetch - When true, SWR key is null and no fetch occurs
   * @param options.revalidateOnFocus - Override SWR's default focus revalidate.
   *   Pass `false` while a streaming flow owns the in-memory message state so
   *   a focus refetch doesn't clobber it with a stale DB snapshot.
   */
  useFetchMessages: (
    context: ConversationContext,
    options?: { revalidateOnFocus?: boolean; skipFetch?: boolean },
  ) => SWRResponse<UIChatMessage[]>;
}

export const dataSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  DataAction
> = (set, get) => ({
  internal_dispatchMessage: (payload) => {
    const contextKey = messageMapKey(get().context);

    log(
      '[dispatchMessage] start | contextKey=%s | type=%s | id=%s',
      contextKey,
      payload.type,
      'id' in payload ? payload.id : 'ids' in payload ? payload.ids.join(',') : 'N/A',
    );

    // Special handling for messageGroup metadata updates
    // MessageGroups are not in dbMessages, they're injected during query
    if (payload.type === 'updateMessageGroupMetadata') {
      const displayMessages = get().displayMessages;
      const index = displayMessages.findIndex((m) => m.id === payload.id);
      if (index < 0) return;

      const newDisplayMessages = [...displayMessages];
      newDisplayMessages[index] = {
        ...newDisplayMessages[index],
        metadata: { ...newDisplayMessages[index].metadata, ...payload.value },
      };

      set({ displayMessages: stabilizeReferences(displayMessages, newDisplayMessages) }, false, {
        payload,
        type: `dispatchMessage/${payload.type}`,
      });
      return;
    }

    const dbMessages = get().dbMessages;

    // Apply array-based reducer - preserves message order
    const newDbMessages = messagesReducer(dbMessages, payload);

    // Check if anything changed
    if (newDbMessages === dbMessages) {
      log('[dispatchMessage] no change | contextKey=%s', contextKey);
      return;
    }

    // Re-parse for display order and grouping
    const { flatList } = parse(newDbMessages);
    // parse() rebuilds every message/block/tool reference, so pin unchanged
    // subtrees back to their previous identity to preserve memo bailouts.
    const stableFlatList = stabilizeReferences(get().displayMessages, flatList);

    log(
      '[dispatchMessage] updated | contextKey=%s | prevCount=%d | newCount=%d | displayCount=%d',
      contextKey,
      dbMessages.length,
      newDbMessages.length,
      stableFlatList.length,
    );

    set({ dbMessages: newDbMessages, displayMessages: stableFlatList }, false, {
      payload,
      type: `dispatchMessage/${payload.type}`,
    });

    // Sync changes to external store (ChatStore)
    get().onMessagesChange?.(newDbMessages, get().context);
  },

  replaceMessages: (messages) => {
    const contextKey = messageMapKey(get().context);
    const prevDbMessages = get().dbMessages;

    // Parse messages using conversation-flow
    const { flatList } = parse(messages);
    const stableFlatList = stabilizeReferences(get().displayMessages, flatList);

    log(
      '[replaceMessages] | contextKey=%s | prevCount=%d | newCount=%d | displayCount=%d | messageIds=%o',
      contextKey,
      prevDbMessages.length,
      messages.length,
      stableFlatList.length,
      messages.slice(0, 5).map((m) => m.id),
    );

    set({ dbMessages: messages, displayMessages: stableFlatList }, false, 'replaceMessages');

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

  useFetchMessages: (context, options) => {
    const { skipFetch, revalidateOnFocus } = options ?? {};
    // When skipFetch is true, SWR key is null - no fetch occurs
    // This is used when external messages are provided (e.g., creating new thread)
    // Also skip fetch when topicId is null (new conversation state) - there's no server data,
    // only local optimistic updates. Fetching would return empty array and overwrite local data.
    const shouldFetch = !skipFetch && !!context.agentId && !!context.topicId;
    const contextKey = messageMapKey(context);

    log(
      '[useFetchMessages] hook | contextKey=%s | shouldFetch=%s | skipFetch=%s | agentId=%s | topicId=%s',
      contextKey,
      shouldFetch,
      skipFetch,
      context.agentId,
      context.topicId,
    );

    return useClientDataSWRWithSync<UIChatMessage[]>(
      shouldFetch ? messageKeys.list(context) : null,

      () => messageService.getMessages(context),
      {
        ...(revalidateOnFocus !== undefined && { revalidateOnFocus }),
        onData: (data) => {
          if (!data) return;
          if (!context.topicId) return;

          // Defense-in-depth gate: drop any SWR onData while the
          // topic is streaming. DB fan-out for chunk writes is async and lags
          // the WS push by anywhere from 100ms to several seconds; an SWR
          // refetch that lands inside that window returns the assistant row
          // as the LOADING_FLAT placeholder (cLen=3) and would collapse the
          // in-memory streamed content. SWR's own cache still receives the
          // value, so once streaming ends a normal revalidate writes through.
          //
          // This is the catch-all backstop sitting BELOW the SoT consumption
          // in gatewayEventHandler — `mergeFetchedMessagesWithLocalState`'s
          // updatedAt tie-breaker handles most cases on its own, but the
          // updatedAt comparison degenerates when server's pushed snapshot
          // carries a DB updatedAt equal to a later stale fetch's row.
          if (operationSelectors.isAgentRuntimeRunningByContext(context)(getChatStoreState()))
            return;

          const prevDbMessages = get().dbMessages;
          const mergedMessages = mergeFetchedMessagesWithLocalState(data, prevDbMessages);
          const storeContextKey = messageMapKey(get().context);

          // Parse messages using conversation-flow
          const { flatList } = parse(mergedMessages);
          const stableFlatList = stabilizeReferences(get().displayMessages, flatList);

          log(
            '[useFetchMessages] onData | requestContextKey=%s | storeContextKey=%s | prevCount=%d | fetchedCount=%d | displayCount=%d | messageIds=%o',
            contextKey,
            storeContextKey,
            prevDbMessages.length,
            mergedMessages.length,
            stableFlatList.length,
            mergedMessages.slice(0, 5).map((m) => m.id),
          );

          set({
            dbMessages: mergedMessages,
            displayMessages: stableFlatList,
            messagesInit: true,
          });

          // Call onMessagesChange callback with the request context (not current context)
          // This ensures data is stored to the correct topic even if user switched topics
          get().onMessagesChange?.(mergedMessages, context);
        },
      },
    );
  },
});

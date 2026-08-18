import { parse } from '@lobechat/conversation-flow';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { type MessageListPage, messageService } from '@/services/message';
import {
  getMessageListFetchPolicy,
  messageListKey,
  runMessageListQuery,
} from '@/services/message/cache';
import { getChatStoreState } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import {
  isLocalOnlyMessage,
  mergeLocalMessagesByCreatedAt,
} from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import {
  getMessageListPayload,
  isPagedMessageListContext,
  LOAD_MORE_ROUND_LIMIT,
  runPagedMessageListQuery,
  setMessageWindowStart,
  toPagedMessageListContext,
} from '@/store/chat/utils/pagedMessageList';

import { type Store as ConversationStore } from '../../action';
import { isSameConversationContext } from '../../utils/contextGuard';
import { type MessageDispatch } from './reducer';
import { messagesReducer } from './reducer';
import { dataSelectors } from './selectors';
import { stabilizeReferences } from './stabilizeReferences';

const log = debug('lobe-render:features:Conversation');

const mergeFetchedMessagesWithLocalState = (
  fetchedMessages: UIChatMessage[],
  localMessages: UIChatMessage[],
  activeVoiceMessageIds: ReadonlySet<string>,
): UIChatMessage[] => {
  if (localMessages.length === 0) return fetchedMessages;

  const localById = new Map(localMessages.map((message) => [message.id, message]));
  const fetchedIds = new Set(fetchedMessages.map((message) => message.id));
  let changed = false;

  const mergedMessages = fetchedMessages.map((message) => {
    const localMessage = localById.get(message.id);

    if (!localMessage) return message;
    // Once the server returns this id, its persisted row replaces the local-only preview.
    if (isLocalOnlyMessage(localMessage)) return message;
    if (localMessage.updatedAt <= message.updatedAt) return message;

    changed = true;
    return localMessage;
  });

  const missingLocalOnlyMessages = localMessages.filter(
    (message) =>
      isLocalOnlyMessage(message) &&
      activeVoiceMessageIds.has(message.id) &&
      !fetchedIds.has(message.id),
  );

  if (missingLocalOnlyMessages.length === 0) return changed ? mergedMessages : fetchedMessages;

  return mergeLocalMessagesByCreatedAt(mergedMessages, missingLocalOnlyMessages);
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
   * Load the previous (older) rounds of the cursor-paginated window and
   * prepend them to the transcript. No-op outside the paged read path, while
   * a page is already in flight, or when the topic start is reached. A failed
   * page lands in `loadMoreMessagesError` for an inline retry row — it never
   * auto-retries.
   */
  loadMoreMessages: () => Promise<void>;

  /**
   * Replace all messages with new data
   * Used for syncing after database operations (optimistic update pattern)
   *
   * @param messages - New messages array from database
   * @param options.expectedContext - Context captured when an async operation started.
   *   The replacement is discarded if the shared store has since switched context.
   * @param options.skipOnMessagesChange - Set when the messages came FROM the
   *   external store (StoreUpdater prop sync). Echoing them back through
   *   `onMessagesChange` re-writes the SWR message cache with whatever the
   *   bucket held at mount — when that bucket is a partial seed (e.g. only the
   *   topic's first message), the echo's cache mutate lands while the
   *   switch-time revalidation is in flight and discards its result, locking
   *   the UI on the partial list.
   */
  replaceMessages: (
    messages: UIChatMessage[],
    options?: { expectedContext?: ConversationContext; skipOnMessagesChange?: boolean },
  ) => void;

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
  ) => SWRResponse<UIChatMessage[] | MessageListPage>;
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

  loadMoreMessages: async () => {
    const { context, isLoadingMoreMessages, messagesHasMore, messagesNextCursor } = get();
    if (isLoadingMoreMessages || !messagesHasMore || !messagesNextCursor) return;
    if (!context.topicId || !isPagedMessageListContext(context)) return;

    const contextKey = messageMapKey(context);
    set(
      { isLoadingMoreMessages: true, loadMoreMessagesError: undefined },
      false,
      'loadMoreMessages/start',
    );

    try {
      // Deliberately outside the single-flight cache layer: older pages are
      // store-local extensions of the window, never SWR cache entries — the
      // paged SWR key always holds the `[windowStart, newest]` snapshot.
      const page = await messageService.getMessagesByCursor({
        agentId: context.agentId,
        cursor: messagesNextCursor,
        // Scroll-up pages load more rounds than the initial window so history
        // browsing triggers far fewer times (see LOAD_MORE_ROUND_LIMIT).
        roundLimit: LOAD_MORE_ROUND_LIMIT,
        topicId: context.topicId,
      });

      // Topic switched while the page was in flight — the store now belongs to
      // another conversation; drop the result (the flag was reset with it).
      if (messageMapKey(get().context) !== contextKey) return;

      const existing = get().dbMessages;
      const existingIds = new Set(existing.map((message) => message.id));
      const olderMessages = page.messages.filter((message) => !existingIds.has(message.id));
      const merged = [...olderMessages, ...existing];

      const { flatList } = parse(merged);
      const stableFlatList = stabilizeReferences(get().displayMessages, flatList);

      log(
        '[loadMoreMessages] loaded | contextKey=%s | pageCount=%d | totalCount=%d | hasMore=%s',
        contextKey,
        olderMessages.length,
        merged.length,
        page.hasMore,
      );

      set(
        {
          dbMessages: merged,
          displayMessages: stableFlatList,
          isLoadingMoreMessages: false,
          messagesHasMore: page.hasMore,
          messagesNextCursor: page.nextCursor,
          messagesPrependNonce: get().messagesPrependNonce + 1,
          // The loaded window now reaches down to this page's start; later
          // revalidations must anchor here to keep covering it.
          messagesWindowStart: page.windowStart ?? get().messagesWindowStart,
        },
        false,
        'loadMoreMessages/success',
      );

      // The shared window registry is what anchors every later window re-fetch
      // (SWR revalidation AND the gateway handler's mid-stream refetches) —
      // widen it to this page's start so they keep covering the loaded rounds.
      if (page.windowStart) setMessageWindowStart(context, page.windowStart);

      // `source: 'fetch'` — a server snapshot echo; must not write through the
      // SWR cache (the paged key deliberately keeps only the newest window).
      get().onMessagesChange?.(merged, context, { source: 'fetch' });
    } catch (error) {
      if (messageMapKey(get().context) !== contextKey) return;
      log('[loadMoreMessages] failed | contextKey=%s | error=%O', contextKey, error);
      set(
        { isLoadingMoreMessages: false, loadMoreMessagesError: error as Error },
        false,
        'loadMoreMessages/error',
      );
    }
  },

  replaceMessages: (messages, options) => {
    const currentContext = get().context;
    const contextKey = messageMapKey(currentContext);
    if (
      options?.expectedContext &&
      !isSameConversationContext(options.expectedContext, currentContext)
    ) {
      log(
        '[replaceMessages] dropped stale result | requestContextKey=%s | storeContextKey=%s',
        messageMapKey(options.expectedContext),
        contextKey,
      );
      return;
    }

    const prevDbMessages = get().dbMessages;

    // Parse messages using conversation-flow
    const { flatList } = parse(messages);
    const stableFlatList = stabilizeReferences(get().displayMessages, flatList);

    log(
      '[replaceMessages] | contextKey=%s | prevCount=%d | newCount=%d | displayCount=%d | skipOnMessagesChange=%s | messageIds=%o',
      contextKey,
      prevDbMessages.length,
      messages.length,
      stableFlatList.length,
      options?.skipOnMessagesChange,
      messages.slice(0, 5).map((m) => m.id),
    );

    set({ dbMessages: messages, displayMessages: stableFlatList }, false, 'replaceMessages');

    // Sync changes to external store (ChatStore) — skipped for external prop
    // sync, which would only echo the external store's own data back and
    // poison the SWR cache (see interface doc).
    if (!options?.skipOnMessagesChange) {
      get().onMessagesChange?.(messages, options?.expectedContext ?? currentContext);
    }
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
    // Cursor-windowed read path (gateway mode, mainline): fetch the newest
    // rounds instead of the whole topic, under a distinct `paged` key.
    const paged = shouldFetch && isPagedMessageListContext(context);
    const fetchContext = paged ? toPagedMessageListContext(context) : context;
    const contextKey = messageMapKey(context);
    const storeContextKeyAtRequest = messageMapKey(get().context);
    const onMessagesChange = get().onMessagesChange;

    log(
      '[useFetchMessages] hook | contextKey=%s | shouldFetch=%s | skipFetch=%s | paged=%s | agentId=%s | topicId=%s',
      contextKey,
      shouldFetch,
      skipFetch,
      paged,
      context.agentId,
      context.topicId,
    );

    return useClientDataSWRWithSync<UIChatMessage[] | MessageListPage>(
      shouldFetch ? messageListKey(fetchContext) : null,

      // The paged fetcher anchors on the loaded window's start (shared window
      // registry, read at request time) so a revalidation re-fetches the whole
      // `[windowStart, newest]` range — a plain newest page would slide past
      // the loaded older pages and leave a round gap between them.
      () =>
        paged
          ? runPagedMessageListQuery(context)
          : runMessageListQuery(context, messageService.getMessages),
      {
        ...getMessageListFetchPolicy(fetchContext),
        ...(revalidateOnFocus !== undefined && { revalidateOnFocus }),
        // Fresh in-memory or prefetched data can render without an immediate
        // switch-time revalidation. Missing cache data still fetches because
        // SWR always loads when `data` is undefined.
        onData: (data) => {
          if (!data) return;
          if (!context.topicId) return;

          const storeContextKey = messageMapKey(get().context);
          if (storeContextKeyAtRequest !== storeContextKey) {
            log(
              '[useFetchMessages] dropped stale result | requestStoreContextKey=%s | storeContextKey=%s',
              storeContextKeyAtRequest,
              storeContextKey,
            );
            return;
          }

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

          const { messages: fetchedMessages, page } = getMessageListPayload(data);

          const prevDbMessages = get().dbMessages;
          const activeVoiceMessageIds = new Set(
            Object.keys(getChatStoreState().voiceMessageUploadMap),
          );
          const mergedMessages = mergeFetchedMessagesWithLocalState(
            fetchedMessages,
            prevDbMessages,
            activeVoiceMessageIds,
          );

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
            // The paged payload replaces the whole window (anchor semantics),
            // so its metadata replaces the window metadata wholesale too.
            ...(paged
              ? {
                  messagesHasMore: page?.hasMore ?? false,
                  messagesNextCursor: page?.nextCursor ?? null,
                  messagesWindowStart: page?.windowStart ?? null,
                }
              : {}),
          });

          // Use the callback and context captured when this fetch was registered.
          // The store-context guard above rejects results after a topic switch;
          // capturing the callback also prevents routing through a later handler instance.
          // `source: 'fetch'` marks this as a server-snapshot echo: handlers must
          // NOT write it through the SWR cache — at mount, this fires with the
          // stale cached list while the revalidation is in flight, and a cache
          // mutate here trips SWR's mutation race guard, discarding the fresh
          // result (conversation locks on the stale/partial list).
          onMessagesChange?.(mergedMessages, context, { source: 'fetch' });
        },
      },
    );
  },
});

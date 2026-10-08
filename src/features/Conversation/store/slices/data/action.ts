import { parse } from '@lobechat/conversation-flow';
import { type ChatTopic, type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { readConversationMessageListPage } from '@/helpers/conversationMessageRead';
import { useClientDataSWRWithSync } from '@/libs/swr';
import { messageService } from '@/services/message';
import {
  getEarlierHistoryStatus,
  getMessageListCacheIdentity,
  getMessageListFetchPolicy,
  loadEarlierMessagePage,
  messageListKey,
  runMessageListQuery,
} from '@/services/message/cache';
import { topicService } from '@/services/topic';
import { getChatStoreState, useChatStore } from '@/store/chat';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';
import {
  hasPendingInterventions,
  INTERVENTION_REFRESH_INTERVAL,
  isInterventionRunActive,
  reconcileIntervention,
  reconcileStreamingInterventions,
} from '@/store/chat/utils/interventionSync';
import {
  isLocalOnlyMessage,
  mergeLocalMessagesByCreatedAt,
} from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type Store as ConversationStore } from '../../action';
import { isSameConversationContext } from '../../utils/contextGuard';
import { type MessageDispatch } from './reducer';
import { messagesReducer } from './reducer';
import { dataSelectors } from './selectors';
import { stabilizeReferences } from './stabilizeReferences';

const log = debug('lobe-render:features:Conversation');

interface InterventionSnapshot {
  dbMessages: UIChatMessage[];
  topic: ChatTopic | null;
  topicAtRequest?: ChatTopic;
}

const interventionSync = new WeakMap<
  () => ConversationStore,
  { pending: Set<string>; snapshots: WeakMap<UIChatMessage[], InterventionSnapshot> }
>();

const getInterventionSync = (get: () => ConversationStore) => {
  let sync = interventionSync.get(get);
  if (!sync) {
    sync = { pending: new Set(), snapshots: new WeakMap() };
    interventionSync.set(get, sync);
  }
  return sync;
};

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
    const resolved = reconcileIntervention(localMessage, message);
    if (resolved) return resolved;
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
   * Load one round-aligned page of history older than the server's
   * newest-first window and prepend it to the transcript.
   * Self-guarding: no-ops while a page is in flight, once the beginning has
   * been reached, or when the conversation has no server-backed messages yet.
   *
   * Never rejects: a failure is kept in `earlierMessagesError` for the inline
   * error row. While that error stands, gesture-driven calls no-op so scrolling
   * does not silently re-fire a failing request; pass `{ retry: true }` from the
   * explicit Retry action to try again.
   */
  loadEarlierMessages: (options?: { retry?: boolean }) => Promise<void>;

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
    options?: {
      refreshInterval?: number;
      revalidateOnFocus?: boolean;
      skipFetch?: boolean;
      syncInterventions?: boolean;
    },
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
    const { flatList } = parse(newDbMessages, undefined, { threadId: get().context.threadId });
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

  loadEarlierMessages: async (options) => {
    const context = get().context;
    if (!context.agentId || !context.topicId) return;
    if (get().earlierMessagesError !== undefined && !options?.retry) return;
    const status = getEarlierHistoryStatus(context);
    if (status.loading || status.exhausted) return;

    set(
      { earlierMessagesError: undefined, isLoadingEarlierMessages: true },
      false,
      'loadEarlierMessages/start',
    );
    try {
      const merged = await loadEarlierMessagePage(
        context,
        // Read on demand: the cursor comes from the transcript at request time,
        // while the merge runs against the transcript at completion — a stream
        // or edit may have changed it meanwhile. A conversation switch yields
        // `undefined` so the other conversation's rows are never merged.
        () => (isSameConversationContext(context, get().context) ? get().dbMessages : undefined),
        (cursor) =>
          messageService.getEarlierMessages(
            {
              agentId: context.agentId,
              agentShareId: context.agentShareId,
              groupId: context.groupId,
              threadId: context.threadId,
              topicId: context.topicId,
              topicShareId: context.topicShareId,
            },
            cursor,
          ),
      );
      // `undefined` → nothing to prepend (no cursor, already loading, the
      // beginning was reached, or the request went stale while in flight).
      if (!merged) return;

      log(
        '[loadEarlierMessages] prepended | contextKey=%s | mergedCount=%d',
        messageMapKey(context),
        merged.length,
      );
      get().replaceMessages(merged, { expectedContext: context });
    } catch (error) {
      log('[loadEarlierMessages] failed | contextKey=%s | %O', messageMapKey(context), error);
      // The list fires this without awaiting, so the failure is surfaced
      // through state (inline error row with Retry) instead of a rejection.
      if (isSameConversationContext(context, get().context)) {
        set({ earlierMessagesError: error }, false, 'loadEarlierMessages/error');
      }
    } finally {
      // The flag is conversation-wide state: after a context switch it belongs
      // to the new conversation (reset by createEphemeralResetState), so a
      // late settle from the previous one must not clear it.
      if (isSameConversationContext(context, get().context)) {
        set({ isLoadingEarlierMessages: false }, false, 'loadEarlierMessages/end');
      }
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
    const { flatList } = parse(messages, undefined, { threadId: get().context.threadId });
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
    const { skipFetch, revalidateOnFocus, refreshInterval = 0 } = options ?? {};
    // When skipFetch is true, SWR key is null - no fetch occurs
    // This is used when external messages are provided (e.g., creating new thread)
    // Also skip fetch when topicId is null (new conversation state) - there's no server data,
    // only local optimistic updates. Fetching would return empty array and overwrite local data.
    const shouldFetch = !skipFetch && !!context.agentId && !!context.topicId;
    const contextKey = messageMapKey(context);
    const sync = getInterventionSync(get);
    const syncKey = getMessageListCacheIdentity(context);
    // Shared views use share-authorized services; thread runs do not own the
    // topic's main runningOperation marker. Keep their existing refresh path.
    const syncContinuation =
      options?.syncInterventions &&
      !context.agentShareId &&
      !context.topicShareId &&
      !context.threadId;
    const storeContextKeyAtRequest = messageMapKey(get().context);
    const onMessagesChange = get().onMessagesChange;

    log(
      '[useFetchMessages] hook | contextKey=%s | shouldFetch=%s | skipFetch=%s | agentId=%s | topicId=%s',
      contextKey,
      shouldFetch,
      skipFetch,
      context.agentId,
      context.topicId,
    );

    return useClientDataSWRWithSync<UIChatMessage[]>(
      shouldFetch ? messageListKey(context) : null,

      async () => {
        const dbMessages = get().dbMessages;
        const topicAtRequest = context.topicId
          ? topicSelectors.getTopicById(context.topicId)(getChatStoreState())
          : undefined;
        const wasPending = hasPendingInterventions(dbMessages);
        let messages = await runMessageListQuery(context, readConversationMessageListPage);
        if (!syncContinuation || !context.topicId) return messages;
        if (wasPending || hasPendingInterventions(messages)) sync.pending.add(syncKey);
        if (!sync.pending.has(syncKey) || hasPendingInterventions(messages)) return messages;

        // The decision must precede the liveness read. A startup reservation is
        // still live even before runningOperation is published.
        const topic = await topicService.getTopicDetail(context.topicId);
        if (!isInterventionRunActive(topic)) {
          // Read after completion without dropping loaded history or its cursor.
          messages = await runMessageListQuery(context, readConversationMessageListPage, {
            force: true,
          });
        }
        const result = [...messages];
        sync.snapshots.set(result, { dbMessages, topic, topicAtRequest });
        return result;
      },
      {
        ...getMessageListFetchPolicy(context),
        // Pending cards must observe answers from another device before the
        // normal message cache's 30-second verification window expires.
        ...((refreshInterval > 0 || sync.pending.has(syncKey)) && { dedupingInterval: 1000 }),
        refreshInterval: syncContinuation
          ? () => (sync.pending.has(syncKey) ? INTERVENTION_REFRESH_INTERVAL : refreshInterval)
          : refreshInterval,
        refreshWhenHidden: false,
        refreshWhenOffline: false,
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

          // DB chunk writes can lag behind pushed content, even at an equal
          // updatedAt. Keep streamed rows, but allow answers and unseen rows in.
          // A parked run must not block the first load of the conversation.
          const prevDbMessages = get().dbMessages;
          const snapshot = sync.snapshots.get(data);
          sync.snapshots.delete(data);
          const chat = getChatStoreState();
          const currentTopic = topicSelectors.getTopicById(context.topicId)(chat);
          const ownsTopic = snapshot && currentTopic === snapshot.topicAtRequest;
          const completed = ownsTopic && !isInterventionRunActive(snapshot.topic);
          const isStreaming =
            get().messagesInit &&
            operationSelectors.isAgentRuntimeRunningByContext(context)(chat) &&
            !(completed && snapshot.dbMessages === prevDbMessages);
          const activeVoiceMessageIds = new Set(
            Object.keys(getChatStoreState().voiceMessageUploadMap),
          );
          const mergedMessages = isStreaming
            ? reconcileStreamingInterventions(prevDbMessages, data)
            : mergeFetchedMessagesWithLocalState(data, prevDbMessages, activeVoiceMessageIds);
          // Do not replace a topic marker claimed by a local send or newer push.
          if (snapshot && !hasPendingInterventions(mergedMessages) && ownsTopic) {
            if (completed && !isStreaming) sync.pending.delete(syncKey);
            const runningOperation = snapshot.topic?.metadata?.runningOperation;
            if (
              runningOperation &&
              currentTopic?.metadata?.runningOperation?.operationId !== runningOperation.operationId
            ) {
              // Publish the marker for useGatewayReconnect; it owns connection
              // deduplication and retry. Do not open a second socket here.
              if (currentTopic) {
                chat.internal_dispatchTopic({
                  id: context.topicId,
                  type: 'updateTopic',
                  containerKey: topicSelectors.getTopicContainerKeyById(context.topicId)(chat),
                  agentId: context.agentId,
                  groupId: context.groupId,
                  value: { metadata: { ...currentTopic.metadata, runningOperation } },
                });
              } else if (snapshot.topic) {
                useChatStore.setState({
                  topicDetailMap: { ...chat.topicDetailMap, [context.topicId]: snapshot.topic },
                });
              }
            }
          }
          if (isStreaming && mergedMessages === prevDbMessages) return;

          // Parse messages using conversation-flow
          const { flatList } = parse(mergedMessages, undefined, { threadId: context.threadId });
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

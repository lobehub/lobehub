import { parse } from '@lobechat/conversation-flow';
import { type ChatTopic, type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { useEffect, useMemo, useRef } from 'react';
import { type StateCreator } from 'zustand/vanilla';

import { readConversationMessageListPage } from '@/helpers/conversationMessageRead';
import { createReplicaSlice, type ReplicaLens } from '@/libs/replica';
import { messageService } from '@/services/message';
import {
  getMessageListCacheIdentity,
  getMessageListFetchPolicy,
  getMessageListWindowOlderCursor,
  runMessageListQuery,
  supportsRoundCursor,
} from '@/services/message/cache';
import {
  type ConversationMessageFetch,
  type ConversationMessagePage,
  type ConversationMessageParams,
  conversationMessagesKey,
  conversationMessagesResource,
  toPersistedTranscript,
  transcriptOf,
} from '@/services/message/replica';
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
  ) => MessageSyncResult;
}

/** Fetch flags of the transcript sync. The rows live in the store (`dbMessages`). */
export interface MessageSyncResult {
  error: unknown;
  /** A first fetch is in flight and nothing is on screen yet. */
  isLoading: boolean;
  isValidating: boolean;
  /** Re-run the head sync. */
  mutate: () => Promise<unknown>;
}

/** What a head response resolved to, handed from `prepareHead` to the sync's `onSuccess`. */
interface HeadResolution {
  completed: boolean;
  /** The response changed nothing during a stream: kept off the transcript. */
  dropped: boolean;
  isStreaming: boolean;
  mergedMessages: UIChatMessage[];
  ownsTopic: boolean;
  snapshot?: InterventionSnapshot;
}

const isStreamingContext = (context: ConversationContext) =>
  operationSelectors.isAgentRuntimeRunningByContext(context)(useChatStore.getState());

export const dataSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  DataAction
> = (set, get) => {
  const sync = getInterventionSync(get);
  /** Head responses resolved by `prepareHead`, read back by the sync's `onSuccess`. */
  const headResolutions = new WeakMap<UIChatMessage[], HeadResolution>();

  // ---- transcript view -------------------------------------------------------
  // The store holds one conversation: `dbMessages` (rows) + `messagePaging`
  // (bookkeeping) are the replica's view of the current context's entry, and
  // the parsed `displayMessages` is derived in the same commit.
  const NO_PAGING = {} as Omit<ConversationMessagePage, 'items'>;
  const views = new WeakMap<UIChatMessage[], WeakMap<object, ConversationMessagePage>>();
  const remember = (items: UIChatMessage[], paging: object, view: ConversationMessagePage) => {
    let byPaging = views.get(items);
    if (!byPaging) views.set(items, (byPaging = new WeakMap()));
    byPaging.set(paging, view);
    return view;
  };
  const hasTranscript = (state: ConversationStore) =>
    !!state.messagePaging || state.dbMessages.length > 0;

  const transcriptLens: ReplicaLens<ConversationStore, ConversationMessagePage> = {
    clear: () => ({ dbMessages: [], displayMessages: [], messagePaging: undefined }),
    get: (state, key) => {
      if (key !== conversationMessagesKey(state.context) || !hasTranscript(state)) return undefined;
      const paging = state.messagePaging ?? NO_PAGING;
      return (
        views.get(state.dbMessages)?.get(paging) ??
        remember(
          state.dbMessages,
          paging,
          state.messagePaging
            ? { ...state.messagePaging, items: state.dbMessages }
            : transcriptOf(state.dbMessages),
        )
      );
    },
    keys: (state) => (hasTranscript(state) ? [conversationMessagesKey(state.context)] : []),
    set: (state, key, data) => {
      // Late writes for a conversation this store no longer shows are dropped.
      if (key !== conversationMessagesKey(state.context)) return {};
      if (!data) return { dbMessages: [], displayMessages: [], messagePaging: undefined };
      const { items, ...paging } = data;
      remember(items, paging, data);
      // parse() rebuilds every message/block/tool reference, so pin unchanged
      // subtrees back to their previous identity to preserve memo bailouts.
      const { flatList } = parse(items, undefined, { threadId: state.context.threadId });
      return {
        dbMessages: items,
        displayMessages: stabilizeReferences(state.displayMessages, flatList),
        messagePaging: paging,
      };
    },
  };

  // ---- reads ---------------------------------------------------------------
  const fetchHead = async (context: ConversationMessageParams): Promise<UIChatMessage[]> => {
    const syncKey = getMessageListCacheIdentity(context);
    const dbMessages = get().dbMessages;
    const topicAtRequest = context.topicId
      ? topicSelectors.getTopicById(context.topicId)(getChatStoreState())
      : undefined;
    const wasPending = hasPendingInterventions(dbMessages);
    let messages = await runMessageListQuery(context, readConversationMessageListPage);
    if (!context.syncInterventions || !context.topicId) return messages;
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
  };

  const fetchOlder = async (
    context: ConversationMessageParams,
    cursor: NonNullable<ConversationMessagePage['nextCursor']>,
  ): Promise<ConversationMessageFetch> => {
    const page = await messageService.getEarlierMessages(
      {
        agentId: context.agentId,
        agentShareId: context.agentShareId,
        groupId: context.groupId,
        threadId: context.threadId,
        topicId: context.topicId,
        topicShareId: context.topicShareId,
      },
      cursor,
    );
    // Without a reported cursor, `length < pageSize` is NOT a reliable end
    // signal — the round-start trim legitimately shortens full pages — so only
    // an empty page marks the top (`applyNextPage`).
    return { items: page.messages, nextCursor: page.olderCursor };
  };

  /**
   * Fold a fetched head window into the shown transcript the way the
   * conversation always has: drop results for a conversation no longer shown,
   * keep streamed rows and unanswered interventions during a run, and keep
   * client rows the server snapshot cannot know yet.
   */
  const prepareHead = (
    incoming: ConversationMessageFetch,
    current: ConversationMessagePage | undefined,
    context: ConversationMessageParams,
  ): ConversationMessageFetch | undefined => {
    if (!Array.isArray(incoming)) return incoming;
    if (!context.topicId) return undefined;

    const storeContextKey = messageMapKey(get().context);
    if (storeContextKey !== messageMapKey(context)) {
      log(
        '[useFetchMessages] dropped stale result | requestContextKey=%s | storeContextKey=%s',
        messageMapKey(context),
        storeContextKey,
      );
      return undefined;
    }

    // DB chunk writes can lag behind pushed content, even at an equal
    // updatedAt. Keep streamed rows, but allow answers and unseen rows in.
    // A parked run must not block the first load of the conversation.
    const prevDbMessages = current?.items ?? get().dbMessages;
    const snapshot = sync.snapshots.get(incoming);
    sync.snapshots.delete(incoming);
    const chat = getChatStoreState();
    const currentTopic = topicSelectors.getTopicById(context.topicId)(chat);
    const ownsTopic = !!snapshot && currentTopic === snapshot.topicAtRequest;
    const completed = ownsTopic && !isInterventionRunActive(snapshot!.topic);
    const isStreaming =
      get().messagesInit &&
      operationSelectors.isAgentRuntimeRunningByContext(context)(chat) &&
      !(completed && snapshot!.dbMessages === prevDbMessages);
    const activeVoiceMessageIds = new Set(Object.keys(chat.voiceMessageUploadMap));
    const mergedMessages = isStreaming
      ? reconcileStreamingInterventions(prevDbMessages, incoming)
      : mergeFetchedMessagesWithLocalState(incoming, prevDbMessages, activeVoiceMessageIds);
    const dropped = isStreaming && mergedMessages === prevDbMessages;

    headResolutions.set(incoming, {
      completed,
      dropped,
      isStreaming,
      mergedMessages,
      ownsTopic,
      snapshot,
    });
    if (dropped) return undefined;

    log(
      '[useFetchMessages] head | contextKey=%s | prevCount=%d | fetchedCount=%d',
      storeContextKey,
      prevDbMessages.length,
      mergedMessages.length,
    );
    return { items: mergedMessages, nextCursor: getMessageListWindowOlderCursor(context) };
  };

  const transcript = createReplicaSlice(conversationMessagesResource, {
    actionPrefix: 'conversationMessages',
    fetcher: (context, cursor) => (cursor ? fetchOlder(context, cursor) : fetchHead(context)),
    get,
    prepareHead,
    set,
    stateKey: 'messageReplica',
    toPersisted: toPersistedTranscript,
    view: transcriptLens,
  });

  /** Write rows to the shown transcript (memory only; see `settleTranscript`). */
  const writeTranscript = (messages: UIChatMessage[], preservePaging = false) =>
    transcript.update(
      conversationMessagesKey(get().context),
      (current) =>
        current &&
        (preservePaging ||
          (current.items.length === messages.length &&
            current.items.every((item, index) => item.id === messages[index].id)))
          ? { ...current, items: messages }
          : transcriptOf(messages),
      { persist: false },
    );

  /**
   * Persist the shown transcript once it is settled — never per streamed
   * chunk; the snapshot written at run end is the one that survives a reload.
   */
  const settleTranscript = () => {
    const context = get().context;
    if (isStreamingContext(context)) return;
    transcript.persist(conversationMessagesKey(context));
  };

  return {
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

      log(
        '[dispatchMessage] updated | contextKey=%s | prevCount=%d | newCount=%d',
        contextKey,
        dbMessages.length,
        newDbMessages.length,
      );

      writeTranscript(newDbMessages, true);
      settleTranscript();

      // Sync changes to external store (ChatStore)
      get().onMessagesChange?.(newDbMessages, get().context);
    },

    loadEarlierMessages: async (options) => {
      const context = get().context;
      if (!context.agentId || !context.topicId) return;
      if (get().earlierMessagesError !== undefined && !options?.retry) return;

      const key = conversationMessagesKey(context);
      const read = () => transcriptLens.get(get(), key);
      const view = read();
      if (!view || view.isLoadingMore) return;

      // A transcript seeded by the host (not yet confirmed by this store's own
      // sync) pages from the window cursor this session already fetched. A
      // cursor rebuilt from a row's millisecond `createdAt` would skip older
      // rows sharing that millisecond, so a round-cursor read waits for it.
      if (get().messageReplica.entries[key]?.source !== 'server' && view.nextCursor === undefined) {
        const windowCursor = getMessageListWindowOlderCursor(context);
        if (windowCursor === undefined && supportsRoundCursor(context)) return;
        if (windowCursor !== undefined)
          transcript.update(
            key,
            (data) => data && { ...data, hasMore: windowCursor !== null, nextCursor: windowCursor },
            { persist: false },
          );
      }
      if (!read()?.hasMore) return;

      set(
        { earlierMessagesError: undefined, isLoadingEarlierMessages: true },
        false,
        'loadEarlierMessages/start',
      );
      const before = get().dbMessages;
      await transcript.loadMore(key, context);

      // The flag is conversation-wide state: after a context switch it belongs
      // to the new conversation (reset by createEphemeralResetState), so a
      // late settle from the previous one must not clear it.
      if (!isSameConversationContext(context, get().context)) return;
      // Hand the extended transcript to the host: its next sync back into this
      // store would otherwise replace the rows with the shorter window.
      if (get().dbMessages !== before) get().onMessagesChange?.(get().dbMessages, context);
      const error = read()?.loadMoreError;
      if (error)
        log('[loadEarlierMessages] failed | contextKey=%s | %O', messageMapKey(context), error);
      set(
        { earlierMessagesError: error ?? undefined, isLoadingEarlierMessages: false },
        false,
        'loadEarlierMessages/end',
      );
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

      log(
        '[replaceMessages] | contextKey=%s | prevCount=%d | newCount=%d | skipOnMessagesChange=%s | messageIds=%o',
        contextKey,
        get().dbMessages.length,
        messages.length,
        options?.skipOnMessagesChange,
        messages.slice(0, 5).map((m) => m.id),
      );

      writeTranscript(messages);
      settleTranscript();

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

      // Invalidate pending automatic recovery before a historical error can mount.
      getChatStoreState().revokeHeteroAutoRetry(state.context);

      // Update the parent's metadata.activeBranchIndex
      // because the branch indicator is on the child message,
      // but the activeBranchIndex is stored on the parent
      await state.updateMessageMetadata(message.parentId, { activeBranchIndex: branchIndex });
    },

    useFetchMessages: (context, options) => {
      const { skipFetch, revalidateOnFocus, refreshInterval = 0 } = options ?? {};
      // When skipFetch is true no fetch occurs. This is used when external
      // messages are provided (e.g., creating new thread). Also skip when
      // topicId is null (new conversation state) - there's no server data,
      // only local optimistic updates. Fetching would return empty array and
      // overwrite local data.
      const shouldFetch = !skipFetch && !!context.agentId && !!context.topicId;
      const syncKey = getMessageListCacheIdentity(context);
      // Shared views use share-authorized services; thread runs do not own the
      // topic's main runningOperation marker. Keep their existing refresh path.
      const syncContinuation =
        !!options?.syncInterventions &&
        !context.agentShareId &&
        !context.topicShareId &&
        !context.threadId;
      const onMessagesChange = get().onMessagesChange;
      // Stable identity: the poll timer restarts whenever the interval option
      // changes, so a fresh function per render would postpone every tick.
      const pollInterval = useMemo(
        () =>
          syncContinuation
            ? () => (sync.pending.has(syncKey) ? INTERVENTION_REFRESH_INTERVAL : refreshInterval)
            : refreshInterval,
        [syncContinuation, syncKey, refreshInterval],
      );

      log(
        '[useFetchMessages] hook | contextKey=%s | shouldFetch=%s | skipFetch=%s',
        messageMapKey(context),
        shouldFetch,
        skipFetch,
      );

      const result = transcript.useSync(
        { ...context, syncInterventions: syncContinuation },
        {
          ...getMessageListFetchPolicy(context),
          enabled: shouldFetch,
          // Pending cards must observe answers from another device before the
          // normal message cache's 30-second verification window expires.
          ...((refreshInterval > 0 || sync.pending.has(syncKey)) && { dedupingInterval: 1000 }),
          onSuccess: (fetched) => {
            const resolution = Array.isArray(fetched) ? headResolutions.get(fetched) : undefined;
            if (!resolution || !context.topicId) return;
            headResolutions.delete(fetched as UIChatMessage[]);
            const { completed, dropped, isStreaming, mergedMessages, ownsTopic, snapshot } =
              resolution;

            // Do not replace a topic marker claimed by a local send or newer push.
            if (snapshot && !hasPendingInterventions(mergedMessages) && ownsTopic) {
              if (completed && !isStreaming) sync.pending.delete(syncKey);
              const chat = getChatStoreState();
              const currentTopic = topicSelectors.getTopicById(context.topicId)(chat);
              const runningOperation = snapshot.topic?.metadata?.runningOperation;
              if (
                runningOperation &&
                currentTopic?.metadata?.runningOperation?.operationId !==
                  runningOperation.operationId
              ) {
                // Publish the marker for useGatewayReconnect; it owns connection
                // deduplication and retry. Do not open a second socket here.
                if (currentTopic) {
                  chat.internal_dispatchTopic({
                    agentId: context.agentId,
                    containerKey: topicSelectors.getTopicContainerKeyById(context.topicId)(chat),
                    groupId: context.groupId,
                    id: context.topicId,
                    type: 'updateTopic',
                    value: { metadata: { ...currentTopic.metadata, runningOperation } },
                  });
                } else if (snapshot.topic) {
                  useChatStore.setState({
                    topicDetailMap: { ...chat.topicDetailMap, [context.topicId]: snapshot.topic },
                  });
                }
              }
            }
            if (dropped) return;
            set({ messagesInit: true }, false, 'useFetchMessages/init');

            // Use the callback and context captured when this fetch was
            // registered. `source: 'fetch'` marks this as a server-snapshot
            // echo: handlers must NOT write it through the SWR cache.
            onMessagesChange?.(get().dbMessages, context, { source: 'fetch' });
          },
          refreshInterval: pollInterval,
          refreshWhenHidden: false,
          refreshWhenOffline: false,
          ...(revalidateOnFocus !== undefined && { revalidateOnFocus }),
        },
      );

      // Streamed chunks stay in memory; the transcript is persisted once the
      // run settles, so a reload restores the finished reply.
      const isStreaming = useChatStore(operationSelectors.isAgentRuntimeRunningByContext(context));
      const streamingKey = conversationMessagesKey(context);
      const wasStreamingRef = useRef({ key: streamingKey, running: isStreaming });
      useEffect(() => {
        if (
          wasStreamingRef.current.key === streamingKey &&
          wasStreamingRef.current.running &&
          !isStreaming
        )
          settleTranscript();
        wasStreamingRef.current = { key: streamingKey, running: isStreaming };
      }, [isStreaming, streamingKey]);

      // A transcript painted from storage before the network answers is
      // handed to the host too, so its views (and runs) see the same rows.
      const key = conversationMessagesKey(context);
      const bridgedKeyRef = useRef<string>(undefined);
      useEffect(() => {
        if (!result.isHydrated || bridgedKeyRef.current === key) return;
        bridgedKeyRef.current = key;
        const state = get();
        if (state.messageReplica.entries[key]?.source !== 'storage') return;
        set({ messagesInit: true }, false, 'useFetchMessages/hydrated');
        onMessagesChange?.(state.dbMessages, context, { source: 'fetch' });
      }, [result.isHydrated, key]);

      return {
        error: result.error,
        isLoading: result.isValidating && !get().messagesInit,
        isValidating: result.isValidating,
        mutate: result.revalidate,
      };
    },
  };
};

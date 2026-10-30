import { type ChatTopic, type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';

import {
  readConversationMessageListPage,
  readEarlierConversationMessages,
} from '@/helpers/conversationMessageRead';
import { createReplicaSlice, readReplicaStoredKeys } from '@/libs/replica';
import { lambdaClient } from '@/libs/trpc/client';
import {
  getMessageListCacheIdentity,
  getMessageListWindowOlderCursor,
  runMessageListQuery,
} from '@/services/message/cache';
import {
  type ConversationMessageFetch,
  type ConversationMessagePage,
  type ConversationMessageParams,
  conversationMessagesKey,
  conversationMessagesResource,
  persistedContextOf,
  toPersistedTranscript,
  transcriptOf,
} from '@/services/message/replica';
import {
  readMessagesForward,
  SHARED_TOPIC_FIRST_PAGE,
  takePrimedForwardMessagePage,
} from '@/services/message/roundCursorPage';
import { topicService } from '@/services/topic';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { type ChatStore } from '@/store/chat/store';
import {
  hasPendingInterventions,
  isInterventionRunActive,
  reconcileStreamingInterventions,
} from '@/store/chat/utils/interventionSync';
import { type StoreSetter } from '@/store/types';

import { reconcileAssistantToolLinks } from '../utils/reconcileTools';
import { bucketOfKey, createTranscriptLens } from './lens';
import { type HeadRequestBoundary, mergeFetchedMessagesWithLocalState } from './mergeFetched';

const log = debug('lobe-store:message-transcript');

export interface InterventionSnapshot {
  dbMessages: UIChatMessage[];
  topic: ChatTopic | null;
  topicAtRequest?: ChatTopic;
}

/** What a head response resolved to, handed from `prepareHead` to the sync's `onSuccess`. */
export interface HeadResolution {
  completed: boolean;
  /** The response changed nothing during a stream: kept off the transcript. */
  dropped: boolean;
  isStreaming: boolean;
  mergedMessages: UIChatMessage[];
  ownsTopic: boolean;
  snapshot?: InterventionSnapshot;
}

type TranscriptContext = Partial<ConversationContext> & Pick<ConversationContext, 'agentId'>;

/**
 * The chat store's message replica: one entry per conversation bucket, the
 * only writer of `dbMessagesMap` / `messagesMap`. Every surface showing a
 * conversation reads that bucket; streamed chunks stay in memory and the
 * settled transcript persists, so a reload paints the finished reply.
 */
const createMessageTranscript = (set: StoreSetter<ChatStore>, get: () => ChatStore) => {
  /** Main-topic sync keys waiting for a parked intervention run to settle. */
  const pendingInterventions = new Set<string>();
  const snapshots = new WeakMap<UIChatMessage[], InterventionSnapshot>();
  /** Head responses resolved by `prepareHead`, read back by the sync's `onSuccess`. */
  const headResolutions = new WeakMap<UIChatMessage[], HeadResolution>();
  /**
   * A read's own view of the writes that happened after it was issued. A read
   * that is still in flight when a send lands resolves with the pre-send
   * snapshot; the rows that send created must survive it even once the send
   * operation has handed off to the runtime.
   *
   * Records are created when a read starts and released when the whole fetch
   * settles — including the topic-detail wait and a forced re-read. Nothing is
   * shared, pruned or capped across reads, so a later read can never discard
   * what an earlier unfinished one still needs.
   */
  type HeadReadRecord = {
    /** Client-created ids this read cannot treat as server-authoritative. */
    clientIds: Set<string>;
    /** Number of fetch responses that have not settled with this record yet. */
    refs: number;
    /**
     * When the server came to know a protected id (confirmed it, or assigned
     * it to a remapped row). A physical request issued after that point
     * returns the row if it still exists, so omitting it is authoritative.
     */
    serverKnownAt: Map<string, number>;
  };
  const activeHeadReads = new Set<HeadReadRecord>();
  const headReads = new WeakMap<UIChatMessage[], HeadReadRecord>();
  /** Client-created rows a server snapshot has not returned yet. */
  const unconfirmedClientIds = new Set<string>();
  /** Orders physical requests against the moments ids became server-known. */
  let clock = 0;
  /**
   * When the physical request behind each head result was issued. A logical
   * read can issue several (a cache generation restart, a forced re-read), and
   * only the one whose response is applied decides what it may omit.
   */
  const physicalStarts = new WeakMap<UIChatMessage[], number>();
  /** The entry key each bucket was last written under. */
  const bucketKeys = new Map<string, string>();

  const createHeadRead = (): HeadReadRecord => {
    // A row created before this read but not yet persisted is still missing
    // from an authoritative snapshot, so it starts in the record too.
    const record: HeadReadRecord = {
      clientIds: new Set(unconfirmedClientIds),
      refs: 1,
      serverKnownAt: new Map(),
    };
    activeHeadReads.add(record);
    return record;
  };

  const retainHeadRead = (record: HeadReadRecord) => {
    record.refs += 1;
    activeHeadReads.add(record);
  };

  /**
   * Drop one fetch's reference. A shared record stays active until every
   * response that uses it has settled, so no fetch can lose protection that
   * another unfinished one still needs.
   */
  const releaseHeadRead = (record: HeadReadRecord) => {
    if (record.refs <= 0) return;
    record.refs -= 1;
    if (record.refs === 0) activeHeadReads.delete(record);
  };

  /**
   * A client mutation created this row. Only these rows may be missing from a
   * read that predates their server persistence. Rows applied from a server
   * response (`replaceMessages`) and rows painted from hydration are known to
   * the server, so a snapshot that omits one stays authoritative.
   */
  const noteClientWrite = (id: string) => {
    unconfirmedClientIds.add(id);
    for (const record of activeHeadReads) record.clientIds.add(id);
  };

  /**
   * The server knows these ids from now on. Active reads keep protecting them
   * only against a response whose physical request was issued earlier.
   */
  const markServerKnown = (ids: Iterable<string>, at = ++clock) => {
    for (const id of ids) {
      for (const record of activeHeadReads) {
        if (record.clientIds.has(id) && !record.serverKnownAt.has(id)) {
          record.serverKnownAt.set(id, at);
        }
      }
    }
  };

  /**
   * A server snapshot returned these rows. Their client-side mark is settled,
   * so a later snapshot that omits one is authoritative (a remote delete).
   * Runs even when the replacement leaves the bucket unchanged.
   */
  const confirmServerRows = (messages: UIChatMessage[]) => {
    markServerKnown(messages.map((message) => message.id));
    for (const message of messages) unconfirmedClientIds.delete(message.id);
  };

  /**
   * The server acknowledged persisting these client rows without returning a
   * snapshot. Reads issued before the acknowledgement may still miss them; a
   * later one that omits them is authoritative.
   */
  const confirmPersistedRows = (ids: string[]) => {
    markServerKnown(ids);
    forgetClientRows(ids);
  };

  /** Client rows that no longer exist locally (deleted, removed or remapped). */
  const forgetClientRows = (ids: Iterable<string>) => {
    for (const id of ids) unconfirmedClientIds.delete(id);
  };

  /**
   * A server replacement removed or remapped client rows (an optimistic
   * `tmp_*` id swapped for the server id). They can never be preserved again,
   * but a read that was already protecting one predates the rows that replaced
   * it, so those take over its protection in that read only.
   */
  const remapClientRows = (removedIds: string[], addedIds: string[]) => {
    forgetClientRows(removedIds);
    if (addedIds.length === 0) return;
    const at = ++clock;
    for (const record of activeHeadReads) {
      if (!removedIds.some((id) => record.clientIds.has(id))) continue;
      for (const id of addedIds) {
        record.clientIds.add(id);
        // The server assigned it just now: only a request issued earlier can
        // be missing it.
        if (!record.serverKnownAt.has(id)) record.serverKnownAt.set(id, at);
      }
    }
  };

  /**
   * Issue one physical head request, stamping its result with the moment it
   * was issued. The cache can call this again for a restarted generation.
   */
  const readHeadPage: typeof readConversationMessageListPage = async (context) => {
    const startedAt = ++clock;
    const result = await readConversationMessageListPage(context);
    physicalStarts.set(Array.isArray(result) ? result : result.messages, startedAt);
    return result;
  };

  /** Ids `record` still protects in a response issued at `startedAt`. */
  const protectedIds = (record: HeadReadRecord, startedAt: number | undefined) => {
    if (startedAt === undefined || record.serverKnownAt.size === 0) return record.clientIds;
    const ids = new Set<string>();
    for (const id of record.clientIds) {
      const knownAt = record.serverKnownAt.get(id);
      if (knownAt === undefined || knownAt > startedAt) ids.add(id);
    }
    return ids;
  };

  const lens = createTranscriptLens();

  /**
   * The entry key of a conversation. A write whose context lacks a field the
   * sync carried (a share id) must land in the entry the sync established, so
   * the bucket's current key wins over a recomputed one.
   */
  const keyOf = (context: TranscriptContext) => {
    const key = conversationMessagesKey(context as ConversationContext);
    return bucketKeys.get(bucketOfKey(key).bucket) ?? key;
  };

  const bucketRows = (key: string) => get().dbMessagesMap[bucketOfKey(key).bucket];

  /**
   * Associate a fetch with the record that tracks a shared result, and return
   * that record. Concurrent reads can join one query result; the first record
   * registered for an array survives, the other one is folded into it and its
   * reference transferred. Every copy of the result then keeps using a record
   * that stays live until all of them settle.
   */
  const registerHeadRead = (messages: UIChatMessage[], record: HeadReadRecord): HeadReadRecord => {
    const existing = headReads.get(messages);
    if (!existing) {
      headReads.set(messages, record);
      return record;
    }
    if (existing === record) return record;

    for (const id of record.clientIds) existing.clientIds.add(id);
    for (const [id, at] of record.serverKnownAt) {
      const existingAt = existing.serverKnownAt.get(id);
      // The earliest observation is the authoritative one.
      if (existingAt === undefined || at < existingAt) existing.serverKnownAt.set(id, at);
    }
    retainHeadRead(existing);
    releaseHeadRead(record);
    return existing;
  };

  // ---- reads ---------------------------------------------------------------
  const fetchForward = async (
    context: ConversationMessageParams,
    cursor: ConversationMessagePage['nextCursor'] = null,
  ): Promise<ConversationMessageFetch> => {
    const page = cursor
      ? await readMessagesForward(lambdaClient, context, cursor)
      : await (takePrimedForwardMessagePage(context) ??
          readMessagesForward(lambdaClient, context, null, SHARED_TOPIC_FIRST_PAGE));
    return { items: page.messages, nextCursor: page.newerCursor };
  };

  const fetchHead = async (context: ConversationMessageParams): Promise<UIChatMessage[]> => {
    const syncKey = getMessageListCacheIdentity(context);
    const bucket = conversationMessagesKey(context);
    /**
     * The record for the read whose response will be applied. The forced
     * re-read after an intervention replaces it, because rows confirmed or
     * remapped while awaiting the topic decision become authoritative then.
     */
    let read = createHeadRead();
    try {
      const dbMessages = bucketRows(bucket) ?? [];
      const topicAtRequest = context.topicId
        ? topicSelectors.getTopicById(context.topicId)(get())
        : undefined;
      const wasPending = hasPendingInterventions(dbMessages);
      let messages = await runMessageListQuery(context, readHeadPage);
      read = registerHeadRead(messages, read);
      if (!context.syncInterventions || !context.topicId) return messages;
      if (wasPending || hasPendingInterventions(messages)) pendingInterventions.add(syncKey);
      if (!pendingInterventions.has(syncKey) || hasPendingInterventions(messages)) return messages;

      // The decision must precede the liveness read. A startup reservation is
      // still live even before runningOperation is published.
      const topic = await topicService.getTopicDetail(context.topicId);
      if (!isInterventionRunActive(topic)) {
        // This read starts after any confirmation or remap that happened while
        // awaiting the topic decision, so its omission is authoritative. The
        // first read's response is discarded, so its record can go with it.
        releaseHeadRead(read);
        read = createHeadRead();
        // Read after completion without dropping loaded history or its cursor.
        messages = await runMessageListQuery(context, readHeadPage, {
          force: true,
        });
        read = registerHeadRead(messages, read);
      }
      const result = [...messages];
      const startedAt = physicalStarts.get(messages);
      if (startedAt !== undefined) physicalStarts.set(result, startedAt);
      // The copy is what `prepareHead` receives. It must use the record that
      // survived for the shared result, not one this fetch already released.
      read = registerHeadRead(result, read);
      snapshots.set(result, { dbMessages, topic, topicAtRequest });
      return result;
    } catch (error) {
      // A rejected fetch never reaches `prepareHead`; drop its record here.
      releaseHeadRead(read);
      throw error;
    }
  };

  const fetchOlder = async (
    context: ConversationMessageParams,
    cursor: NonNullable<ConversationMessagePage['nextCursor']>,
  ): Promise<ConversationMessageFetch> => {
    const page = await readEarlierConversationMessages(
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
   * Fold a fetched head window into the bucket the way the conversation always
   * has: keep streamed rows and unanswered interventions during a run, and
   * keep client rows the server snapshot cannot know yet.
   */
  const prepareHead = (
    incoming: ConversationMessageFetch,
    current: ConversationMessagePage | undefined,
    context: ConversationMessageParams,
  ): ConversationMessageFetch | undefined => {
    if (!Array.isArray(incoming)) return incoming;
    // Several fetchers can join one result. The earliest request is the most
    // conservative boundary for what any of their responses can be missing.
    const read = headReads.get(incoming);
    // The read record is released by `onSettled`, which runs for every success
    // including the responses the replica discards before this point.

    // A returned row is server-confirmed: a later snapshot may remove it.
    confirmServerRows(incoming);
    if (!context.topicId) return undefined;

    // Client rows this read cannot treat as authoritative: unconfirmed when it
    // was issued, or created while it was in flight.
    const boundary: HeadRequestBoundary | undefined = read && {
      unconfirmedClientIds: protectedIds(read, physicalStarts.get(incoming)),
    };

    // DB chunk writes can lag behind pushed content, even at an equal
    // updatedAt. Keep streamed rows, but allow answers and unseen rows in.
    // A parked run must not block the first load of the conversation.
    const prevDbMessages = current?.items ?? [];
    const snapshot = snapshots.get(incoming);
    snapshots.delete(incoming);
    const chat = get();
    const currentTopic = topicSelectors.getTopicById(context.topicId)(chat);
    const ownsTopic = !!snapshot && currentTopic === snapshot.topicAtRequest;
    const completed = ownsTopic && !isInterventionRunActive(snapshot!.topic);
    const isStreaming =
      !!current &&
      operationSelectors.isAgentRuntimeRunningByContext(context)(chat) &&
      !(completed && snapshot!.dbMessages === prevDbMessages);
    const activeVoiceMessageIds = new Set(Object.keys(chat.voiceMessageUploadMap));
    const creatingMessageIds = new Set(
      prevDbMessages
        .filter((message) => operationSelectors.isMessageCreating(message.id)(chat))
        .map((message) => message.id),
    );
    // A poll ahead of the stream appends tool rows the stream has not
    // delivered while keeping their local owner, whose tools[] has not caught
    // up yet. Re-link them like every other bucket write does, or they render
    // as orphans until the next refresh (see reconcileAssistantToolLinks).
    const mergedMessages = reconcileAssistantToolLinks(
      isStreaming
        ? reconcileStreamingInterventions(prevDbMessages, incoming)
        : mergeFetchedMessagesWithLocalState(
            incoming,
            prevDbMessages,
            activeVoiceMessageIds,
            creatingMessageIds,
            boundary,
          ),
    );
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
      '[head] key=%s | prevCount=%d | fetchedCount=%d',
      conversationMessagesKey(context),
      prevDbMessages.length,
      mergedMessages.length,
    );
    return { items: mergedMessages, nextCursor: getMessageListWindowOlderCursor(context) };
  };

  const slice = createReplicaSlice(conversationMessagesResource, {
    actionPrefix: 'messageTranscript',
    effects: {
      // Every settled success releases its read record, including responses
      // the replica discards before `prepareHead` (off-scope, superseded,
      // cleared, removed, or dropped by the merge).
      onSettled: (data) => {
        if (!Array.isArray(data)) return;
        const record = headReads.get(data);
        if (record) releaseHeadRead(record);
      },
    },
    fetcher: (context, cursor) =>
      context.messageReadMode === 'forward'
        ? fetchForward(context, cursor)
        : cursor
          ? fetchOlder(context, cursor)
          : fetchHead(context),
    get,
    prepareHead,
    set,
    stateKey: 'messageReplica',
    toPersisted: toPersistedTranscript,
    view: {
      ...lens,
      set: (state, key, data) => {
        const { bucket } = bucketOfKey(key);
        if (data) bucketKeys.set(bucket, key);
        else if (bucketKeys.get(bucket) === key) bucketKeys.delete(bucket);
        return lens.set(state, key, data);
      },
    },
  });

  /**
   * Write a conversation's rows (memory only). An unchanged id sequence keeps
   * the entry's paging; so does `preservePaging` (a reducer edit of the same
   * window). Rows that changed only after an unchanged oldest row (a run step
   * adding its assistant and tool rows) keep what is known about the history
   * before it: re-assuming more there would page a reached topic start again
   * on every scroll to the top while the run goes on. Anything else is a
   * fresh, unpaged transcript.
   */
  const commit = (
    context: TranscriptContext,
    messages: UIChatMessage[],
    preservePaging = false,
    clientCreatedId?: string,
  ) => {
    const key = keyOf(context);
    // Only a row a client mutation created can be missing from a read that
    // predates its server persistence. Hydration writes through the replica
    // slice and `replaceMessages` applies server data, so neither is tracked.
    if (clientCreatedId) noteClientWrite(clientCreatedId);
    return slice.update(
      key,
      (current) => {
        if (!current) return transcriptOf(messages);
        if (
          preservePaging ||
          (current.items.length === messages.length &&
            current.items.every((item, index) => item.id === messages[index].id))
        )
          return { ...current, items: messages };
        const keepsOlderEdge =
          context.messageReadMode !== 'forward' &&
          current.items.length > 0 &&
          current.items[0].id === messages[0]?.id;
        return keepsOlderEdge
          ? { ...transcriptOf(messages), hasMore: current.hasMore, nextCursor: current.nextCursor }
          : transcriptOf(messages);
      },
      { persist: false },
    );
  };

  /**
   * Persist a conversation once it is settled — never per streamed chunk; the
   * snapshot written at run end is the one that survives a reload.
   */
  const settle = (context: TranscriptContext) => {
    if (operationSelectors.isAgentRuntimeRunningByContext(context as ConversationContext)(get()))
      return;
    const key = keyOf(context);
    if (lens.get(get(), key)) slice.persist(key);
  };

  /**
   * Drop the transcripts of conversations that no longer exist (a deleted
   * topic, agent or group) from memory and from storage, so their rows never
   * hydrate again. Without `predicate` every transcript of the active scope
   * goes. Persisted rows an earlier session wrote are reached through the
   * replica's stored-key index. Memory-only (`m:`) entries do not survive a
   * reload, and their keys do not name the conversation, so they are left to
   * the session.
   */
  const evict = async (predicate?: (context: ConversationContext) => boolean): Promise<void> => {
    if (!predicate) {
      unconfirmedClientIds.clear();
      await slice.clear();
      return;
    }
    const matches = (key: string) => {
      const context = persistedContextOf(key);
      return !!context && predicate(context as ConversationContext);
    };
    const scope = conversationMessagesResource.scope.get();
    const loaded = new Set(lens.keys!(get()));
    for (const key of loaded) {
      if (!matches(key)) continue;
      // No later replacement or delete reaches an evicted conversation, so its
      // client rows' marks go with it.
      forgetClientRows((bucketRows(key) ?? []).map((message) => message.id));
      slice.remove(key);
    }

    const persisted = await readReplicaStoredKeys(conversationMessagesResource);
    // `remove` resolves against the active scope; another identity's rows are not ours.
    if (conversationMessagesResource.scope.get() !== scope) return;
    for (const key of persisted) if (!loaded.has(key) && matches(key)) slice.remove(key);
  };

  return {
    commit,
    confirmPersistedRows,
    confirmServerRows,
    /** @internal Test/debug view of the ids a stale read may still preserve. */
    debugUnconfirmedClientIds: () => [...unconfirmedClientIds],
    evict,
    forgetClientRows,
    remapClientRows,
    headResolutions,
    keyOf,
    pendingInterventions,
    /** The entry's current value, as the replica sees it. */
    read: (key: string) => lens.get(get(), key),
    settle,
    slice,
  };
};

export type MessageTranscript = ReturnType<typeof createMessageTranscript>;

const transcripts = new WeakMap<() => ChatStore, MessageTranscript>();

/** The store's one transcript replica, shared by every message action class. */
export const getMessageTranscript = (
  set: StoreSetter<ChatStore>,
  get: () => ChatStore,
): MessageTranscript => {
  let transcript = transcripts.get(get);
  if (!transcript) transcripts.set(get, (transcript = createMessageTranscript(set, get)));
  return transcript;
};

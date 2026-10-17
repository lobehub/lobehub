import { type ChatTopic, type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';

import { readConversationMessageListPage } from '@/helpers/conversationMessageRead';
import { createReplicaSlice } from '@/libs/replica';
import { messageService } from '@/services/message';
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
  toPersistedTranscript,
  transcriptOf,
} from '@/services/message/replica';
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

import { bucketOfKey, createTranscriptLens } from './lens';
import { mergeFetchedMessagesWithLocalState } from './mergeFetched';

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
  /** The entry key each bucket was last written under. */
  const bucketKeys = new Map<string, string>();

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

  // ---- reads ---------------------------------------------------------------
  const fetchHead = async (context: ConversationMessageParams): Promise<UIChatMessage[]> => {
    const syncKey = getMessageListCacheIdentity(context);
    const dbMessages = bucketRows(conversationMessagesKey(context)) ?? [];
    const topicAtRequest = context.topicId
      ? topicSelectors.getTopicById(context.topicId)(get())
      : undefined;
    const wasPending = hasPendingInterventions(dbMessages);
    let messages = await runMessageListQuery(context, readConversationMessageListPage);
    if (!context.syncInterventions || !context.topicId) return messages;
    if (wasPending || hasPendingInterventions(messages)) pendingInterventions.add(syncKey);
    if (!pendingInterventions.has(syncKey) || hasPendingInterventions(messages)) return messages;

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
    snapshots.set(result, { dbMessages, topic, topicAtRequest });
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
    if (!context.topicId) return undefined;

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
    const mergedMessages = isStreaming
      ? reconcileStreamingInterventions(prevDbMessages, incoming)
      : mergeFetchedMessagesWithLocalState(
          incoming,
          prevDbMessages,
          activeVoiceMessageIds,
          creatingMessageIds,
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
    fetcher: (context, cursor) => (cursor ? fetchOlder(context, cursor) : fetchHead(context)),
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
   * window). Anything else is a fresh, unpaged transcript.
   */
  const commit = (context: TranscriptContext, messages: UIChatMessage[], preservePaging = false) =>
    slice.update(
      keyOf(context),
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
   * Persist a conversation once it is settled — never per streamed chunk; the
   * snapshot written at run end is the one that survives a reload.
   */
  const settle = (context: TranscriptContext) => {
    if (operationSelectors.isAgentRuntimeRunningByContext(context as ConversationContext)(get()))
      return;
    const key = keyOf(context);
    if (lens.get(get(), key)) slice.persist(key);
  };

  return {
    commit,
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

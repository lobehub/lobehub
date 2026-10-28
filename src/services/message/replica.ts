import type { ConversationContext, UIChatMessage } from '@lobechat/types';

import { AppIndexedDBStorage } from '@/libs/replica';
import {
  cacheScope,
  defineReplica,
  isReplicaSyncKey,
  REPLICA_INDEX_KEY,
  replicaKeys,
  type ReplicaPagedData,
  type ReplicaPageResult,
  type ReplicaPagingConfig,
  type ReplicaRow,
  type ReplicaRowKey,
  type ReplicaStorage,
  replicaSWRDriver,
} from '@/libs/replica';
import {
  type CanonicalMessageListContext,
  normalizeMessageListQueryContext,
} from '@/libs/swr/keys';
import type { MessageService } from '@/services/message';
import type { MessageRoundCursor } from '@/services/message/cache';
import { isLocalOnlyMessage } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/** A conversation transcript as the replica keeps it: rows oldest-first, plus paging bookkeeping. */
export type ConversationMessagePage = ReplicaPagedData<UIChatMessage, MessageRoundCursor>;

/**
 * A transcript fetch: the head window is the plain row list (the shape the
 * message list query and the chat store's head merge work with); older pages
 * carry their cursor.
 */
export type ConversationMessageFetch =
  UIChatMessage[] | ReplicaPageResult<UIChatMessage, MessageRoundCursor>;

/** What a transcript sync is asked for: the conversation, plus how its head is read. */
export interface ConversationMessageParams extends ConversationContext {
  /** Re-read the head after a parked intervention run completes (main topics only). */
  syncInterventions?: boolean;
}

/** Synthetic MessageGroup nodes are injected by the query, not DB rows. */
const isSyntheticGroupNode = (message: UIChatMessage) =>
  message.role === 'compressedGroup' || message.role === 'compareGroup';

/**
 * Whether a transcript may survive a reload. Shared views read through
 * share-authorized endpoints and are not the viewer's data; scoped buckets
 * (page copilot `documentId`, group-agent `subAgentId`, `isNew`) carry a
 * discriminator the canonical read drops, so persisting them would store the
 * scoped transcript under the ordinary conversation.
 */
const isPersistableContext = (context: ConversationContext) => {
  if (!context.agentId || !context.topicId) return false;
  if (context.agentShareId || context.topicShareId) return false;
  if (context.messageReadMode === 'forward') return false;
  return messageMapKey(context) === canonicalBucketOf(context);
};

const canonicalBucketOf = (context: {
  agentId?: string | null;
  groupId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}) =>
  messageMapKey({
    agentId: context.agentId ?? '',
    groupId: context.groupId ?? undefined,
    scope: context.threadId ? 'thread' : context.groupId ? 'group' : 'main',
    threadId: context.threadId,
    topicId: context.topicId,
  });

/**
 * Entry identity of a conversation. Persistable conversations key by the
 * canonical read context (`p:`), so the route loader and every surface showing
 * the same conversation address one row; the rest key by their bucket (`m:`)
 * and stay in memory. A forward transcript is its own entry: its pages run the
 * other way, so it never shares paging with the newest-first one.
 */
export const conversationMessagesKey = (context: ConversationContext) =>
  isPersistableContext(context)
    ? `p:${JSON.stringify(normalizeMessageListQueryContext(context))}`
    : `m:${JSON.stringify({
        bucket: messageMapKey(context),
        threadId: context.threadId ?? null,
        ...(context.messageReadMode === 'forward' && { paging: 'forward' }),
      })}`;

/**
 * The canonical read context a persisted (`p:`) entry key was built from;
 * `undefined` for memory-only (`m:`) keys, whose bucket does not name it.
 */
export const persistedContextOf = (key: string): CanonicalMessageListContext | undefined =>
  key.startsWith('p:') ? JSON.parse(key.slice(2)) : undefined;

/**
 * The chat store bucket (`messageMapKey`) an entry key renders into, and the
 * thread its rows are parsed for. Every key is built by
 * {@link conversationMessagesKey}, so both are recoverable from it.
 */
export const transcriptBucketOf = (key: string): { bucket: string; threadId: string | null } => {
  const value = JSON.parse(key.slice(2));
  if (key.startsWith('p:')) return { bucket: canonicalBucketOf(value), threadId: value.threadId };
  return { bucket: value.bucket, threadId: value.threadId };
};

const isForwardTranscriptKey = (key: string) =>
  key.startsWith('m:') && JSON.parse(key.slice(2)).paging === 'forward';

const transcriptPaging: ReplicaPagingConfig<UIChatMessage, MessageRoundCursor> = {
  // Only reached for read paths without round cursors (threads, shared
  // views): main topics always report the window's lossless cursor.
  deriveCursor: (message) => ({
    createdAt: new Date(message.createdAt).toISOString(),
    id: message.id,
  }),
  direction: 'backward',
  directionOf: (key) => (isForwardTranscriptKey(key) ? 'forward' : 'backward'),
  getId: (message) => message.id,
  isCursorable: (message) => !isSyntheticGroupNode(message) && !isLocalOnlyMessage(message),
  mode: 'cursor',
  // The newest window survives a reload; older history is fetched again.
  persist: { pages: 1 },
};

const CONVERSATION_MESSAGES_NAME = 'conversationMessages';
const CONVERSATION_MESSAGES_VERSION = 1;

/**
 * The conversation a transcript sync reads, without fetch-only options
 * (`syncInterventions`): persisted entries by their canonical read context,
 * memory-only ones by their context. Surfaces showing one conversation with
 * different options then share one sync, as they share one entry.
 */
const syncContextOf = (params: ConversationMessageParams, key: string) => {
  const { syncInterventions: _, ...context } = params;
  return persistedContextOf(key) ?? context;
};

export const conversationMessagesResource = defineReplica<
  ConversationMessageParams,
  ConversationMessagePage,
  ConversationMessageFetch
>({
  key: conversationMessagesKey,
  name: CONVERSATION_MESSAGES_NAME,
  paging: transcriptPaging,
  persistKey: (key) => key.startsWith('p:'),
  storage: 'indexedDB',
  // A `replica:sync` key, so `slice.revalidate` and the predicate revalidation
  // below match it; a `message:` key would hit the SWR persistence tier and
  // store every transcript (shared and scoped ones included) a second time.
  // Its params are the conversation, not the full sync params: one read per
  // entry, so two responses never settle out of order into one transcript.
  syncKey: (params) => {
    const key = conversationMessagesKey(params);
    return replicaKeys.sync(
      CONVERSATION_MESSAGES_NAME,
      CONVERSATION_MESSAGES_VERSION,
      cacheScope.get(),
      key,
      syncContextOf(params, key),
    );
  },
  version: CONVERSATION_MESSAGES_VERSION,
});

/**
 * Revalidate the transcript syncs of the active scope whose conversation
 * matches `predicate` (every one when omitted) — the conversation-shaped
 * matcher for code that cannot name one entry key (a whole topic across its
 * threads, every transcript after a bulk change).
 */
export const revalidateConversationMessages = (
  predicate?: (context: ConversationMessageParams) => boolean,
) =>
  replicaSWRDriver.revalidate((queryKey) => {
    if (
      !isReplicaSyncKey(queryKey, conversationMessagesResource.name, {
        scope: conversationMessagesResource.scope.get(),
      })
    )
      return false;
    // `replicaKeys.sync` puts the sync's conversation last (see `syncContextOf`).
    return !predicate || predicate((queryKey as unknown[])[5] as ConversationMessageParams);
  });

/** Strip rows that must never be persisted (local-only placeholders with blob URLs). */
export const toPersistedTranscript = (data: ConversationMessagePage): ConversationMessagePage => {
  if (!data.items.some(isLocalOnlyMessage)) return data;
  return { ...data, items: data.items.filter((message) => !isLocalOnlyMessage(message)) };
};

/**
 * A transcript value for rows that arrived without paging bookkeeping. Whether
 * older history exists is unknown, so it is assumed until an empty page says
 * otherwise.
 */
export const transcriptOf = (items: UIChatMessage[]): ConversationMessagePage => ({
  currentPage: 0,
  hasMore: items.length > 0,
  items,
  pageSize: items.length,
});

// ---- tool result payloads ------------------------------------------------

/**
 * The stored body of one tool message the conversation read projected away
 * (`payloadOmitted`), fetched back when the user opens the card. `value` is
 * wrapped so an answered-but-empty payload still replaces a stale row.
 */
export interface ToolResultPayloadRead {
  value?: ToolResultPayload;
}

export type ToolResultPayload = Awaited<ReturnType<MessageService['getToolResultPayload']>>;

/**
 * Rows larger than this stay in memory only: a single tool result can be
 * megabytes (a page scrape, a long log), and a reload refetching that one is
 * cheaper than keeping it on disk.
 */
export const TOOL_RESULT_PAYLOAD_MAX_PERSISTED_CHARS = 128 * 1024;

/** Recently opened payloads that survive a reload; older rows are evicted LRU. */
export const TOOL_RESULT_PAYLOAD_MAX_PERSISTED_ENTRIES = 200;

const TOOL_RESULT_PAYLOAD_NAME = 'toolResultPayload';
const TOOL_RESULT_PAYLOAD_VERSION = 1;

const serializedLength = (value: unknown) => {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Infinity;
  }
};

/**
 * IndexedDB storage that refuses oversized payload rows: the write becomes a
 * delete, so neither the large body nor an older copy of it hydrates later.
 * The engine's own index row passes through untouched.
 */
export class SizeCappedPayloadStorage implements ReplicaStorage<ToolResultPayloadRead> {
  readonly #inner: ReplicaStorage<ToolResultPayloadRead>;
  readonly #maxChars: number;

  constructor(inner: ReplicaStorage<ToolResultPayloadRead>, maxChars: number) {
    this.#inner = inner;
    this.#maxChars = maxChars;
  }

  get = (key: ReplicaRowKey) => this.#inner.get(key);

  getStrict = (key: ReplicaRowKey) =>
    this.#inner.getStrict ? this.#inner.getStrict(key) : this.#inner.get(key);

  remove = (key: ReplicaRowKey) => this.#inner.remove(key);

  set = (key: ReplicaRowKey, row: ReplicaRow<ToolResultPayloadRead>) => {
    if (key.queryKey !== REPLICA_INDEX_KEY && serializedLength(row.data) > this.#maxChars)
      return this.#inner.remove(key);
    return this.#inner.set(key, row);
  };
}

/**
 * Projected tool payloads by message id. Immutable per message, so after a
 * reload the card paints the persisted copy and the read only confirms it.
 * Partitioned by the cache scope (user + workspace), bounded by count and by
 * row size.
 */
export const toolResultPayloadResource = defineReplica<string, ToolResultPayloadRead>({
  key: (messageId) => messageId,
  name: TOOL_RESULT_PAYLOAD_NAME,
  persist: { maxEntries: TOOL_RESULT_PAYLOAD_MAX_PERSISTED_ENTRIES },
  storage: new SizeCappedPayloadStorage(
    new AppIndexedDBStorage<ToolResultPayloadRead>({
      namespace: `replica:${TOOL_RESULT_PAYLOAD_NAME}:v${TOOL_RESULT_PAYLOAD_VERSION}`,
    }),
    TOOL_RESULT_PAYLOAD_MAX_PERSISTED_CHARS,
  ),
  version: TOOL_RESULT_PAYLOAD_VERSION,
});

import type { ConversationContext, UIChatMessage } from '@lobechat/types';

import {
  defineReplica,
  type ReplicaPagedData,
  type ReplicaPageResult,
  type ReplicaPagingConfig,
} from '@/libs/replica';
import { normalizeMessageListQueryContext } from '@/libs/swr/keys';
import { messageListKey, type MessageRoundCursor } from '@/services/message/cache';
import { isLocalOnlyMessage } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/** A conversation transcript as the replica keeps it: rows oldest-first, plus paging bookkeeping. */
export type ConversationMessagePage = ReplicaPagedData<UIChatMessage, MessageRoundCursor>;

/**
 * A transcript fetch: the head window is the plain row list (the same shape
 * every `message:list` consumer and cache write uses, so a fetch shared with
 * the chat store stays one shape); older pages carry their cursor.
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
  const canonical = messageMapKey({
    agentId: context.agentId,
    groupId: context.groupId,
    scope: context.threadId ? 'thread' : context.groupId ? 'group' : 'main',
    threadId: context.threadId,
    topicId: context.topicId,
  });
  return messageMapKey(context) === canonical;
};

/**
 * Entry identity of a conversation. Persistable conversations key by the
 * canonical read context (`p:`), so the route loader and every surface showing
 * the same conversation address one row; the rest key by their bucket (`m:`)
 * and stay in memory.
 */
export const conversationMessagesKey = (context: ConversationContext) =>
  isPersistableContext(context)
    ? `p:${JSON.stringify(normalizeMessageListQueryContext(context))}`
    : `m:${messageMapKey(context)}`;

const transcriptPaging: ReplicaPagingConfig<UIChatMessage, MessageRoundCursor> = {
  // Only reached for read paths without round cursors (threads, shared
  // views): main topics always report the window's lossless cursor.
  deriveCursor: (message) => ({
    createdAt: new Date(message.createdAt).toISOString(),
    id: message.id,
  }),
  direction: 'backward',
  getId: (message) => message.id,
  isCursorable: (message) => !isSyntheticGroupNode(message) && !isLocalOnlyMessage(message),
  mode: 'cursor',
  // The newest window survives a reload; older history is fetched again.
  persist: { pages: 1 },
};

export const conversationMessagesResource = defineReplica<
  ConversationMessageParams,
  ConversationMessagePage,
  ConversationMessageFetch
>({
  key: conversationMessagesKey,
  name: 'conversationMessages',
  paging: transcriptPaging,
  persistKey: (key) => key.startsWith('p:'),
  storage: 'indexedDB',
  // Mutations, refreshes and evictions across the app revalidate the
  // conversation by its `message:list` key.
  syncKey: (params) => messageListKey(params),
  version: 1,
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
export const transcriptOf = (
  items: UIChatMessage[],
  current?: ConversationMessagePage,
): ConversationMessagePage =>
  current
    ? { ...current, items }
    : { currentPage: 0, hasMore: items.length > 0, items, pageSize: items.length };

/**
 * The transcript persisted for a conversation, read without a store — for the
 * route loader, which runs before any Conversation store exists. `undefined`
 * when the conversation is kept in memory only or nothing is stored.
 */
export const readPersistedTranscript = async (
  context: ConversationContext,
): Promise<ConversationMessagePage | undefined> => {
  const { persistKey, scope, storage, storageKey } = conversationMessagesResource;
  if (!storage || !persistKey(conversationMessagesKey(context))) return undefined;
  const row = await storage.get({ queryKey: storageKey(context), scope: scope.get() });
  return row?.data;
};

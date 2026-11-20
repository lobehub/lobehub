import type { UIChatMessage } from '@lobechat/types';

import {
  type CanonicalMessageListContext,
  messageKeys,
  type MessageListQueryContext,
  normalizeMessageListQueryContext,
} from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';

export const MESSAGE_LIST_VERIFICATION_INTERVAL = 30_000;

const MAX_MESSAGE_LIST_CLIENT_STATES = 500;

interface ActiveMessageListRequest {
  generation: number;
  promise: Promise<UIChatMessage[]>;
  settled: boolean;
}

interface MessageListClientState {
  activeRequestGenerations: Set<number>;
  cacheScope: string;
  context: CanonicalMessageListContext;
  currentRequest?: ActiveMessageListRequest;
  generation: number;
  identity: string;
  verifiedAt?: number;
}

const messageListClientStates = new Map<string, MessageListClientState>();

/**
 * Round cursor for paging older history: the `(createdAt, id)` of the oldest
 * loaded round's start. `createdAt` is the server's lossless microsecond ISO
 * string, so a page boundary never drops rows sharing a millisecond.
 */
export interface MessageRoundCursor {
  createdAt: string;
  id: string;
}

/**
 * One page of a conversation. `olderCursor` points at the next older page;
 * `null` means the topic start is already loaded, and `undefined` means the
 * read path cannot tell (it has no round cursor).
 */
export interface MessageListPage {
  messages: UIChatMessage[];
  olderCursor?: MessageRoundCursor | null;
}

/**
 * A topic's mainline conversation pages by round cursor. Threads and agent-share
 * visitor topics stay on `getMessages` — neither has a round-cursor read.
 */
export const supportsRoundCursor = (context: MessageListQueryContext) =>
  !!context.topicId && !context.threadId && !context.agentShareId;

/**
 * The older-history cursor each identity's newest window came back with. Kept
 * apart from `messageListClientStates`, which is dropped once its verification
 * window lapses, while the rendered window (and so its cursor) stays valid.
 * Entries are two short strings, so the cap matches the client-state cap.
 */
const windowOlderCursors = new Map<string, MessageRoundCursor | null>();

const recordWindowOlderCursor = (
  identity: string,
  cursor: MessageRoundCursor | null | undefined,
) => {
  windowOlderCursors.delete(identity);
  if (cursor === undefined) return;
  windowOlderCursors.set(identity, cursor);
  if (windowOlderCursors.size > MAX_MESSAGE_LIST_CLIENT_STATES) {
    const oldest = windowOlderCursors.keys().next().value;
    if (oldest !== undefined) windowOlderCursors.delete(oldest);
  }
};

/**
 * The older-history cursor the latest newest-first window of `context` came
 * back with: `null` when the topic start is loaded, `undefined` when unknown
 * (no round cursor for this read path, or no window fetched yet).
 */
export const getMessageListWindowOlderCursor = (
  context: MessageListQueryContext,
): MessageRoundCursor | null | undefined =>
  windowOlderCursors.get(getMessageListCacheIdentity(context));

export const messageListKey = (context: MessageListQueryContext) => messageKeys.list(context);

export const getMessageListCacheIdentity = (
  context: MessageListQueryContext,
  cacheScope = getCacheScope(),
) => `${cacheScope}:${JSON.stringify(normalizeMessageListQueryContext(context))}`;

const touchState = (state: MessageListClientState) => {
  messageListClientStates.delete(state.identity);
  messageListClientStates.set(state.identity, state);
};

const activeRequestCount = (state: MessageListClientState) => state.activeRequestGenerations.size;

const hasOlderActiveRequest = (state: MessageListClientState, generation: number) =>
  [...state.activeRequestGenerations].some((activeGeneration) => activeGeneration < generation);

const pruneClientStates = () => {
  while (messageListClientStates.size > MAX_MESSAGE_LIST_CLIENT_STATES) {
    const removable = [...messageListClientStates.entries()].find(
      ([, state]) => activeRequestCount(state) === 0,
    );
    if (!removable) return;
    messageListClientStates.delete(removable[0]);
  }
};

const getOrCreateState = (
  context: MessageListQueryContext,
  cacheScope = getCacheScope(),
): MessageListClientState => {
  const normalizedContext = normalizeMessageListQueryContext(context);
  const identity = getMessageListCacheIdentity(normalizedContext, cacheScope);
  const existing = messageListClientStates.get(identity);
  if (existing) return existing;

  const state: MessageListClientState = {
    activeRequestGenerations: new Set(),
    cacheScope,
    context: normalizedContext,
    generation: 0,
    identity,
  };
  messageListClientStates.set(identity, state);
  pruneClientStates();
  return state;
};

export const isMessageListServerVerified = (context: MessageListQueryContext, now = Date.now()) => {
  const identity = getMessageListCacheIdentity(context);
  const state = messageListClientStates.get(identity);
  if (state?.verifiedAt === undefined) return false;

  const age = now - state.verifiedAt;
  if (age >= 0 && age < MESSAGE_LIST_VERIFICATION_INTERVAL) return true;

  state.verifiedAt = undefined;
  if (activeRequestCount(state) === 0) messageListClientStates.delete(identity);
  return false;
};

export const getMessageListFetchPolicy = (context: MessageListQueryContext) => ({
  dedupingInterval: MESSAGE_LIST_VERIFICATION_INTERVAL,
  revalidateIfStale: !isMessageListServerVerified(context),
});

type MessageListQuery = (
  context: CanonicalMessageListContext,
) => Promise<MessageListPage | UIChatMessage[]>;

const startCurrentGenerationQuery = (
  state: MessageListClientState,
  query: MessageListQuery,
  reuseSettledRequest = false,
): Promise<UIChatMessage[]> => {
  const activeRequest = state.currentRequest;
  if (
    activeRequest?.generation === state.generation &&
    (!activeRequest.settled || reuseSettledRequest)
  ) {
    return activeRequest.promise;
  }

  // A verification window describes the last successful server snapshot. Once
  // a real query begins, failure must leave this identity eligible for retry.
  state.verifiedAt = undefined;
  const requestGeneration = state.generation;
  state.activeRequestGenerations.add(requestGeneration);

  const request: Promise<UIChatMessage[]> = Promise.resolve()
    .then(async () => {
      let result: MessageListPage | UIChatMessage[];
      try {
        result = await query(state.context);
      } catch (error) {
        if (state.generation !== requestGeneration) {
          return startCurrentGenerationQuery(state, query, true);
        }
        throw error;
      }

      // Explicit invalidation won while this request was in flight. Resolve
      // every waiter through the current generation instead of publishing the
      // obsolete snapshot or restoring its verification timestamp.
      if (state.generation !== requestGeneration) {
        return startCurrentGenerationQuery(state, query, true);
      }

      const { messages, olderCursor } = Array.isArray(result) ? { messages: result } : result;
      recordWindowOlderCursor(state.identity, olderCursor);

      state.verifiedAt = Date.now();
      touchState(state);
      pruneClientStates();
      return messages;
    })
    .finally(() => {
      state.activeRequestGenerations.delete(requestGeneration);

      if (state.currentRequest?.promise === request) state.currentRequest.settled = true;
      if (
        state.currentRequest?.settled &&
        !hasOlderActiveRequest(state, state.currentRequest.generation)
      ) {
        state.currentRequest = undefined;
      }
      if (activeRequestCount(state) === 0 && state.verifiedAt === undefined) {
        messageListClientStates.delete(state.identity);
      }
    });

  state.currentRequest = { generation: requestGeneration, promise: request, settled: false };
  return request;
};

/**
 * Coordinate one server query per identity scope, canonical context, and
 * request generation. Direct MessageService callers intentionally stay outside
 * this client-cache policy.
 */
export const runMessageListQuery = (
  context: MessageListQueryContext,
  query: MessageListQuery,
  options?: { force?: boolean },
): Promise<UIChatMessage[]> => {
  const state = getOrCreateState(context);
  if (options?.force) {
    // A read after a completion barrier must not join an earlier request.
    // Unlike mutation invalidation, this read keeps client-held history pages.
    state.generation += 1;
    state.verifiedAt = undefined;
  }
  return startCurrentGenerationQuery(state, query);
};

/**
 * Synchronously invalidate verification and advance the request generation for
 * every known matching query in the current identity scope. This must run
 * before SWR mutate so a no-subscriber refresh still forces the next mount to
 * verify with the server.
 */
export const invalidateMessageListClientState = (
  predicate: (context: CanonicalMessageListContext) => boolean,
  cacheScope = getCacheScope(),
): void => {
  for (const state of messageListClientStates.values()) {
    if (state.cacheScope !== cacheScope || !predicate(state.context)) continue;
    state.generation += 1;
    state.verifiedAt = undefined;
  }
};

export const clearMessageListClientCacheState = () => {
  messageListClientStates.clear();
  windowOlderCursors.clear();
};

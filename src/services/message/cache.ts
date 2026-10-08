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
 * Client-held pages of history OLDER than the server's newest-first window
 * The chat read path only ever fetches the newest round-aligned
 * page; when the user walks back past it, the older pages are fetched once via
 * a round cursor and kept here so every later revalidation of the same
 * identity re-merges them instead of collapsing the view back to the window.
 */
interface EarlierHistoryState {
  /**
   * The oldest mainline row of the live window when history was first
   * extended — the join point. A fresh window that no longer contains this id
   * has slid past the cached pages (a gap), so the cache is dropped rather
   * than merged.
   */
  anchorId: string;
  cacheScope: string;
  context: CanonicalMessageListContext;
  /** The topic start has been loaded: nothing older remains to fetch. */
  exhausted: boolean;
  loading: boolean;
  /** Ascending rows strictly older than `anchorId`. */
  messages: UIChatMessage[];
  /** Cursor for the page older than `messages`; `undefined` until a page reports one. */
  olderCursor?: MessageRoundCursor;
}

const earlierHistoryStates = new Map<string, EarlierHistoryState>();

/**
 * Each entry can hold thousands of full message rows, so the cap is much
 * tighter than `MAX_MESSAGE_LIST_CLIENT_STATES`. Insertion order doubles as
 * recency: `touchEarlierHistoryState` re-appends on every merge, and pruning
 * evicts the least-recently-merged identities that are not mid-fetch.
 */
const MAX_EARLIER_HISTORY_STATES = 30;

const touchEarlierHistoryState = (identity: string, state: EarlierHistoryState) => {
  earlierHistoryStates.delete(identity);
  earlierHistoryStates.set(identity, state);
};

const pruneEarlierHistoryStates = () => {
  if (earlierHistoryStates.size <= MAX_EARLIER_HISTORY_STATES) return;
  for (const [identity, state] of earlierHistoryStates.entries()) {
    if (earlierHistoryStates.size <= MAX_EARLIER_HISTORY_STATES) return;
    if (state.loading) continue;
    earlierHistoryStates.delete(identity);
  }
};

/** Synthetic MessageGroup nodes are injected by the query, not DB rows — they
 *  can never serve as a round cursor. */
const isSyntheticGroupNode = (message: UIChatMessage) =>
  message.role === 'compressedGroup' || message.role === 'compareGroup';

const byCreatedAtAscending = (a: UIChatMessage, b: UIChatMessage) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

const mergeEarlierHistory = (identity: string, fresh: UIChatMessage[]): UIChatMessage[] => {
  const state = earlierHistoryStates.get(identity);
  if (!state || state.messages.length === 0) return fresh;

  if (!fresh.some((message) => message.id === state.anchorId)) {
    // The window slid past the join point — merging would hide an invisible
    // gap in the middle of the transcript. Collapse back to the window; the
    // user can walk back again from the new boundary.
    earlierHistoryStates.delete(identity);
    return fresh;
  }

  const freshIds = new Set(fresh.map((message) => message.id));
  const prefix = state.messages.filter((message) => !freshIds.has(message.id));
  touchEarlierHistoryState(identity, state);
  // Stable sort: group nodes carried by the fresh window can predate the whole
  // prefix, and rows inside each list keep their relative order.
  return [...prefix, ...fresh].sort(byCreatedAtAscending);
};

/**
 * Where the next older page starts: the last loaded page's cursor once history
 * was extended, otherwise the window's. `null` → the start is loaded;
 * `undefined` → unknown, derive it from the oldest loaded row.
 */
const resolveOlderCursor = (
  identity: string,
  state: EarlierHistoryState | undefined,
): MessageRoundCursor | null | undefined =>
  state && state.messages.length > 0 ? state.olderCursor : windowOlderCursors.get(identity);

export const getEarlierHistoryStatus = (context: MessageListQueryContext) => {
  const identity = getMessageListCacheIdentity(context);
  const state = earlierHistoryStates.get(identity);
  return {
    exhausted: (state?.exhausted ?? false) || resolveOlderCursor(identity, state) === null,
    loading: state?.loading ?? false,
  };
};

/**
 * Fetch one round-aligned page of history older than the oldest mainline row
 * of `getCurrentMessages()`, remember it for future revalidation merges, and
 * return the full merged transcript — or `undefined` when there is nothing to
 * apply (no cursor, already loading, the beginning was reached, or the request
 * went stale while in flight).
 *
 * `getCurrentMessages` is read twice: once for the cursor, and again AFTER the
 * page arrives so the merge lands on the latest transcript rather than a
 * snapshot taken before the await (a stream or an edit may have changed it
 * meanwhile). Return `undefined` from it to skip the merge, e.g. after the
 * caller switched conversations; the page itself is still cached.
 */
export const loadEarlierMessagePage = async (
  context: MessageListQueryContext,
  getCurrentMessages: () => UIChatMessage[] | undefined,
  fetcher: (cursor: MessageRoundCursor) => Promise<MessageListPage>,
): Promise<UIChatMessage[] | undefined> => {
  const identity = getMessageListCacheIdentity(context);
  const existing = earlierHistoryStates.get(identity);
  if (existing?.exhausted || existing?.loading) return undefined;

  const knownCursor = resolveOlderCursor(identity, existing);
  // The window (or the last page) already reached the topic start.
  if (knownCursor === null) return undefined;
  // A cursor-paged conversation shown from the persisted cache before its
  // revalidation lands has no server cursor yet. A cursor rebuilt from the
  // oldest row's millisecond `createdAt` would skip older rows sharing that
  // millisecond, so wait for the window's lossless cursor instead; the next
  // upward gesture after revalidation pages normally.
  if (knownCursor === undefined && supportsRoundCursor(context)) return undefined;

  const oldest = getCurrentMessages()?.find((message) => !isSyntheticGroupNode(message));
  if (!oldest) return undefined;

  // A read path without round cursors: page from the oldest loaded row.
  const cursor = knownCursor ?? {
    createdAt: new Date(oldest.createdAt).toISOString(),
    id: oldest.id,
  };

  const state: EarlierHistoryState = existing ?? {
    anchorId: oldest.id,
    cacheScope: getCacheScope(),
    context: normalizeMessageListQueryContext(context),
    exhausted: false,
    loading: false,
    messages: [],
  };
  state.loading = true;
  touchEarlierHistoryState(identity, state);
  pruneEarlierHistoryStates();

  try {
    const { messages: page, olderCursor } = await fetcher(cursor);

    // An invalidation (edit/delete refresh) dropped this identity while the
    // page was in flight: its rows may be exactly what changed, so discard it.
    if (earlierHistoryStates.get(identity) !== state) return undefined;

    // Without a reported cursor, `length < pageSize` is NOT a reliable end
    // signal — the round-start trim legitimately shortens full pages — so only
    // an empty page marks the top.
    if (page.length === 0 || olderCursor === null) state.exhausted = true;
    state.olderCursor = olderCursor ?? undefined;
    if (page.length === 0) return undefined;

    const pageIds = new Set(page.map((message) => message.id));
    state.messages = [
      ...page,
      ...state.messages.filter((message) => !pageIds.has(message.id)),
    ].sort(byCreatedAtAscending);

    const latest = getCurrentMessages();
    if (!latest) return undefined;

    const merged = mergeEarlierHistory(identity, latest);
    // No join point in the latest transcript (it slid or was replaced): there
    // is nothing to prepend, and returning `latest` would only echo it back.
    return merged === latest ? undefined : merged;
  } finally {
    state.loading = false;
  }
};

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
      // Re-attach client-held older history (loaded via round cursor) so a
      // revalidation doesn't collapse an extended transcript back to the
      // newest-first window.
      return mergeEarlierHistory(state.identity, messages);
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

  // A force refresh signals the persisted rows may have changed (edits or
  // deletes can target rounds inside the extended range). Cached older pages
  // could resurrect stale rows through the merge, so drop them; the user can
  // walk back again from the refreshed window.
  for (const [identity, state] of earlierHistoryStates.entries()) {
    if (state.cacheScope !== cacheScope || !predicate(state.context)) continue;
    earlierHistoryStates.delete(identity);
  }
};

export const clearMessageListClientCacheState = () => {
  messageListClientStates.clear();
  earlierHistoryStates.clear();
  windowOlderCursors.clear();
};

import { type UIChatMessage } from '@lobechat/types';

import { resolveGatewayModeEnabled } from '@/helpers/gatewayMode';
import { type MessageListQueryContext } from '@/libs/swr/keys';
import { type MessageListPage, type MessageRoundCursor, messageService } from '@/services/message';
import { getMessageListCacheIdentity, runMessageListQuery } from '@/services/message/cache';
import { useAgentStore } from '@/store/agent';

/**
 * Rounds per scroll-up page. Larger than the server's initial-window default
 * (10 rounds) on purpose: the first paint stays small to keep the big first
 * batch off the Cloudflare 100s edge, but scroll-up pages neither block the
 * first paint nor risk that timeout (user-initiated, not batched with agent
 * config), so a bigger page means fewer, rarer load-more triggers. Byte size
 * stays bounded by the server's `countBudget` regardless.
 */
export const LOAD_MORE_ROUND_LIMIT = 25;

/**
 * Whether this conversation context reads through the cursor-paginated
 * (windowed) message path instead of the legacy full fetch.
 *
 * Two gates, both required:
 * - Mainline only: `getMessagesByCursor` covers a topic's mainline (no thread,
 *   no group, no anonymous share) — every other variant keeps the full fetch.
 * - Gateway mode: in gateway mode the server builds model context from the DB
 *   itself, so the client list is display-only and safe to window. In legacy
 *   client mode the client RESENDS the loaded transcript to the model each
 *   turn — a windowed list would silently truncate the model's context.
 */
export const isPagedMessageListContext = (context: MessageListQueryContext): boolean =>
  !!context.topicId &&
  !context.threadId &&
  !context.groupId &&
  !context.topicShareId &&
  resolveGatewayModeEnabled(useAgentStore.getState(), context.agentId ?? undefined);

/** The paged variant of a context — a distinct SWR key / cache identity. */
export const toPagedMessageListContext = (
  context: MessageListQueryContext,
): MessageListQueryContext => ({ ...context, paged: true });

const MAX_WINDOW_START_ENTRIES = 200;

/**
 * The loaded window's lower bound per conversation identity — the `anchor`
 * every subsequent window re-fetch must reach down to. Server-minted lossless
 * microsecond strings only (a client `Date` cannot reconstruct one). Kept in a
 * module registry (not just Conversation-store state) because mid-stream
 * refetches run from the CHAT store's gateway event handler, which has no
 * access to the per-conversation store instance.
 */
const windowStartRegistry = new Map<string, MessageRoundCursor | null>();

const windowStartKey = (context: MessageListQueryContext) =>
  getMessageListCacheIdentity(toPagedMessageListContext(context));

export const getMessageWindowStart = (
  context: MessageListQueryContext,
): MessageRoundCursor | null => windowStartRegistry.get(windowStartKey(context)) ?? null;

export const setMessageWindowStart = (
  context: MessageListQueryContext,
  windowStart: MessageRoundCursor | null,
): void => {
  const key = windowStartKey(context);
  windowStartRegistry.delete(key);
  windowStartRegistry.set(key, windowStart);
  while (windowStartRegistry.size > MAX_WINDOW_START_ENTRIES) {
    const oldest = windowStartRegistry.keys().next().value;
    if (oldest === undefined) break;
    windowStartRegistry.delete(oldest);
  }
};

export const clearMessageWindowStarts = () => windowStartRegistry.clear();

/**
 * Fetch the current window `[windowStart ?? newest page start, newest]` for a
 * paged context and remember its (possibly widened) start. This is the shared
 * primitive under both the SWR fetcher and the mid-stream gateway refetches —
 * anchoring keeps a scrolled-up user's loaded rounds covered instead of
 * collapsing them back to the newest page.
 */
export const fetchPagedMessageWindow = async (
  context: MessageListQueryContext,
  options?: { skipWorks?: boolean },
): Promise<MessageListPage> => {
  const page = await messageService.getMessagesByCursor({
    agentId: context.agentId,
    anchor: getMessageWindowStart(context),
    topicId: context.topicId!,
    ...(options?.skipWorks ? { skipWorks: true } : {}),
  });
  setMessageWindowStart(context, page.windowStart);
  return page;
};

/**
 * Single-flighted cursor fetch of the newest window for the SWR read path.
 * Coordinated per paged identity by the message-list request cache.
 */
export const runPagedMessageListQuery = (
  context: MessageListQueryContext,
): Promise<MessageListPage> =>
  runMessageListQuery<MessageListPage>(toPagedMessageListContext(context), (ctx) =>
    fetchPagedMessageWindow(ctx),
  );

/**
 * Normalize the two message-list payload shapes: the legacy full fetch returns
 * `UIChatMessage[]`, the paged path returns a `MessageListPage`.
 */
export const getMessageListPayload = (
  data: UIChatMessage[] | MessageListPage,
): { messages: UIChatMessage[]; page: MessageListPage | null } =>
  Array.isArray(data) ? { messages: data, page: null } : { messages: data.messages, page: data };

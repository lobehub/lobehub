import type { UIChatMessage } from '@lobechat/types';

import { type MessageListQueryContext, normalizeMessageListQueryContext } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import type { MessageListPage, MessageRoundCursor } from './cache';

/**
 * Rows walked per round-cursor page: whole rounds up to this many mainline rows,
 * matching the newest-first window `getMessages` serves.
 */
export const MESSAGE_PAGE_ROW_BUDGET = 1000;

export interface RoundCursorReadParams extends MessageListQueryContext {
  projectToolPayloads?: boolean;
  skipWorks?: boolean;
}

/** One round-aligned page of a topic's mainline: the newest with a `null` cursor, else older. */
export const readMessagesByRoundCursor = async (
  params: RoundCursorReadParams,
  cursor: MessageRoundCursor | null,
): Promise<MessageListPage> => {
  const page = await lambdaClient.message.getMessagesByCursor.query({
    agentId: params.agentId,
    countBudget: MESSAGE_PAGE_ROW_BUDGET,
    cursor,
    groupId: params.groupId,
    includeFileWorks: true,
    projectToolPayloads: params.projectToolPayloads,
    // The row budget is the real bound; ask for as many whole rounds as it holds.
    roundLimit: MESSAGE_PAGE_ROW_BUDGET,
    skipWorks: params.skipWorks,
    topicId: params.topicId,
    topicShareId: params.topicShareId,
  });

  return {
    messages: page.messages as unknown as UIChatMessage[],
    olderCursor: page.nextCursor,
  };
};

/**
 * Newest pages requested before the code that renders them has loaded, by
 * conversation. The share page knows its conversation from SSR loader data at
 * hydration, while the conversation stack is still downloading; priming there
 * takes the read off that chain. This module stays dependency-light because the
 * share route imports it ahead of the message service and the chat store.
 */
const primedPages = new Map<string, Promise<MessageListPage>>();

const primeKey = (context: MessageListQueryContext) =>
  JSON.stringify(normalizeMessageListQueryContext(context));

/**
 * Start a conversation's newest page now; its first head read takes it instead
 * of asking again. Primed without tool-payload projection: whole payloads are
 * the answer that cannot lose data for any reader.
 */
export const primeMessageListPage = (context: MessageListQueryContext): void => {
  const key = primeKey(context);
  if (primedPages.has(key)) return;

  const page = readMessagesByRoundCursor(context, null);
  // The taker owns failure (it falls back to its own read); an unclaimed page
  // must not surface as an unhandled rejection.
  page.catch(() => {});
  primedPages.set(key, page);
};

/** Hand over a primed page once: every later read of the conversation goes to the server. */
export const takePrimedMessageListPage = (
  context: MessageListQueryContext,
): Promise<MessageListPage> | undefined => {
  const key = primeKey(context);
  const page = primedPages.get(key);
  if (page) primedPages.delete(key);

  return page;
};

import type { UIChatMessage } from '@lobechat/types';

import { type MessageListQueryContext, normalizeMessageListQueryContext } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import type { MessageListPage, MessageRoundCursor } from './cache';

/**
 * Rows walked per round-cursor page: whole rounds up to this many mainline rows,
 * matching the newest-first window `getMessages` serves.
 */
export const MESSAGE_PAGE_ROW_BUDGET = 1000;

// Client-mode reads keep the full budget: the client runtime replays the loaded rows as model history.
export const GATEWAY_PAGE_ROW_BUDGET = 500;

/** Page sizes for reading a topic forward from its first round. */
export interface ForwardPageSize {
  countBudget: number;
  roundLimit: number;
}

/** The first page of a shared topic, embedded in the share document. */
export const SHARED_TOPIC_FIRST_PAGE: ForwardPageSize = { countBudget: 200, roundLimit: 3 };

/** Each page a reader appends while scrolling a shared topic. */
export const FORWARD_PAGE: ForwardPageSize = { countBudget: 1000, roundLimit: 5 };

export interface RoundCursorReadParams extends MessageListQueryContext {
  projectToolPayloads?: boolean;
  skipWorks?: boolean;
}

/** The `getMessagesByCursor` input for one round-aligned page of a topic's mainline. */
export const toRoundCursorQueryInput = (
  params: RoundCursorReadParams,
  cursor: MessageRoundCursor | null,
) => ({
  agentId: params.agentId,
  countBudget: params.projectToolPayloads ? GATEWAY_PAGE_ROW_BUDGET : MESSAGE_PAGE_ROW_BUDGET,
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

export type RoundCursorQueryResult = Awaited<
  ReturnType<typeof lambdaClient.message.getMessagesByCursor.query>
>;

export const toMessageListPage = (page: RoundCursorQueryResult): MessageListPage => ({
  messages: page.messages as unknown as UIChatMessage[],
  olderCursor: page.nextCursor,
});

/** One round-aligned page of a topic's mainline: the newest with a `null` cursor, else older. */
export const readMessagesByRoundCursor = async (
  params: RoundCursorReadParams,
  cursor: MessageRoundCursor | null,
): Promise<MessageListPage> => {
  const input = toRoundCursorQueryInput(params, cursor);
  const page = toMessageListPage(await lambdaClient.message.getMessagesByCursor.query(input));

  if (cursor === null) {
    const key = primeKey(params);
    if (input.countBudget < MESSAGE_PAGE_ROW_BUDGET && page.olderCursor)
      partialHeadWindows.add(key);
    else partialHeadWindows.delete(key);
  }

  return page;
};

const partialHeadWindows = new Set<string>();

// A head page smaller than the client runtime's history window: a client-side run must reload it first.
export const isPartialHeadWindow = (context: MessageListQueryContext): boolean =>
  partialHeadWindows.has(primeKey(context));

/** The `getMessagesByCursor` input for one forward page, starting after `cursor`. */
export const toForwardRoundCursorQueryInput = (
  params: MessageListQueryContext,
  cursor: MessageRoundCursor | null,
  size: ForwardPageSize = FORWARD_PAGE,
) => ({
  agentId: params.agentId,
  countBudget: size.countBudget,
  cursor,
  direction: 'forward' as const,
  groupId: params.groupId,
  includeFileWorks: true,
  roundLimit: size.roundLimit,
  topicId: params.topicId,
  topicShareId: params.topicShareId,
});

/** The server answered with a page it did not read forward. */
export class ForwardPagingUnsupportedError extends Error {
  constructor() {
    super('getMessagesByCursor did not page forward');
    this.name = 'ForwardPagingUnsupportedError';
  }
}

export interface ForwardMessagePage {
  messages: UIChatMessage[];
  /** Cursor for the rounds after this page, or null at the topic's end. */
  newerCursor: MessageRoundCursor | null;
}

interface ForwardCursorClient {
  message: {
    getMessagesByCursor: {
      query: (input: ReturnType<typeof toForwardRoundCursorQueryInput>) => Promise<{
        direction?: 'backward' | 'forward';
        messages: unknown[];
        nextCursor: MessageRoundCursor | null;
      }>;
    };
  };
}

/**
 * One forward page through `client`: the browser's lambda client, or the share
 * worker's server client. A server that predates `direction` strips it and
 * answers with the newest page, so anything not echoed as forward is refused.
 */
export const readMessagesForward = async (
  client: ForwardCursorClient,
  params: MessageListQueryContext,
  cursor: MessageRoundCursor | null,
  size: ForwardPageSize = FORWARD_PAGE,
): Promise<ForwardMessagePage> => {
  const page = await client.message.getMessagesByCursor.query(
    toForwardRoundCursorQueryInput(params, cursor, size),
  );
  if (page.direction !== 'forward') throw new ForwardPagingUnsupportedError();

  return { messages: page.messages as UIChatMessage[], newerCursor: page.nextCursor };
};

/**
 * Newest pages requested before the code that renders them has loaded, by
 * conversation. The share page starts its read from the document, while the
 * conversation stack is still downloading, and hands it over here. This module
 * stays dependency-light because the share route imports it ahead of the
 * message service and the chat store.
 */
const primedPages = new Map<string, Promise<MessageListPage>>();

const primeKey = (context: MessageListQueryContext) =>
  JSON.stringify(normalizeMessageListQueryContext(context));

/**
 * Hand over a conversation's newest page already in flight; its first head read
 * takes it instead of asking again. The page must be read without tool-payload
 * projection: whole payloads are the answer that cannot lose data for any reader.
 */
export const primeMessageListPage = (
  context: MessageListQueryContext,
  page: Promise<MessageListPage>,
): void => {
  const key = primeKey(context);
  if (primedPages.has(key)) return;

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

/** First forward pages handed over by the document, by conversation. */
const primedForwardPages = new Map<string, Promise<ForwardMessagePage>>();

/** Hand over a conversation's first forward page; its forward head read takes it once. */
export const primeForwardMessagePage = (
  context: MessageListQueryContext,
  page: ForwardMessagePage,
): void => {
  primedForwardPages.set(primeKey(context), Promise.resolve(page));
};

export const takePrimedForwardMessagePage = (
  context: MessageListQueryContext,
): Promise<ForwardMessagePage> | undefined => {
  const key = primeKey(context);
  const page = primedForwardPages.get(key);
  if (page) primedForwardPages.delete(key);

  return page;
};

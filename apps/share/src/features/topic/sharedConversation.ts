import { CLIENT_VERSION_HEADER, CURRENT_VERSION } from '@lobechat/const';
import { type ConversationContext } from '@lobechat/types';
import superjson, { type SuperJSONResult } from 'superjson';

import {
  type ForwardMessagePage,
  ForwardPagingUnsupportedError,
  primeForwardMessagePage,
  primeMessageListPage,
  readMessagesForward,
  type RoundCursorQueryResult,
  SHARED_TOPIC_FIRST_PAGE,
  toMessageListPage,
  toRoundCursorQueryInput,
} from '@/services/message/roundCursorPage';
import { type SharedTopicData } from '@/types/topic';

type SharedTopicTarget = Pick<SharedTopicData, 'agentId' | 'groupId' | 'shareId' | 'topicId'>;

interface DocumentSharedTopicMessages {
  response: Promise<unknown>;
  shareId: string;
}

declare global {
  interface Window {
    __LOBE_SHARED_TOPIC_MESSAGES__?: DocumentSharedTopicMessages;
  }
}

/**
 * The conversation a share link shows. The rendered list and the primed read
 * must build it identically, or the list misses the primed page and asks again.
 */
export const toSharedConversationContext = (
  topic: SharedTopicTarget,
  readMode: SharedTopicReadMode = 'backward',
): ConversationContext => ({
  agentId: topic.agentId ?? '',
  groupId: topic.groupId ?? undefined,
  ...(readMode === 'forward' && { messageReadMode: 'forward' as const }),
  topicId: topic.topicId,
  topicShareId: topic.shareId,
});

export type SharedTopicReadMode = 'backward' | 'forward';

/** How the share document reads its transcript, decided once by the loader. */
export interface SharedTopicFirstPage {
  /** The first rounds, embedded in the document; null when the client reads them. */
  firstPage: ForwardMessagePage | null;
  messageReadMode: SharedTopicReadMode;
}

type ForwardReadClient = Parameters<typeof readMessagesForward>[0];

/**
 * Serialized size above which the first page stays out of the document. The
 * worker buffers the whole HTML before sending it, so one heavy first round
 * (a long agent run with tool payloads) would hold back the first paint; the
 * client reads such a page itself, in parallel with the code.
 */
export const SHARED_TOPIC_FIRST_PAGE_MAX_CHARS = 256 * 1024;

/**
 * Read a share's first rounds forward for the document. A server that cannot
 * page forward keeps the page on the newest-first read; any other failure
 * leaves the first page to the client, still forward.
 */
export const readSharedTopicFirstPage = async (
  client: ForwardReadClient,
  shareId: string,
): Promise<SharedTopicFirstPage> => {
  try {
    const firstPage = await readMessagesForward(
      client,
      { topicShareId: shareId },
      null,
      SHARED_TOPIC_FIRST_PAGE,
    );
    if (JSON.stringify(firstPage.messages).length > SHARED_TOPIC_FIRST_PAGE_MAX_CHARS)
      return { firstPage: null, messageReadMode: 'forward' };
    return { firstPage, messageReadMode: 'forward' };
  } catch (error) {
    if (error instanceof ForwardPagingUnsupportedError) {
      return { firstPage: null, messageReadMode: 'backward' };
    }
    console.error('[share] shared topic first page SSR fetch failed:', error);
    return { firstPage: null, messageReadMode: 'forward' };
  }
};

/** The list's first read of the share, as the unbatched tRPC GET the lambda route serves. */
export const sharedTopicMessagesUrl = (topic: SharedTopicTarget) => {
  const input = superjson.serialize(
    toRoundCursorQueryInput(toSharedConversationContext(topic), null),
  );

  return `/trpc/lambda/message.getMessagesByCursor?input=${encodeURIComponent(JSON.stringify(input))}`;
};

// `shareId` comes from the URL: escape everything that could end the script.
const toScriptLiteral = (value: string) =>
  JSON.stringify(value)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('\u2028', String.raw`\u2028`)
    .replaceAll('\u2029', String.raw`\u2029`);

/**
 * An inline script that requests the share's newest messages while the document
 * parses, alongside the module downloads instead of after them. Empty for a
 * share the list would not read: it only reads a conversation it can attribute
 * to an agent (`useFetchMessages`).
 */
export const sharedTopicMessagesScript = (topic: SharedTopicTarget) => {
  if (!topic.agentId) return '';

  const url = toScriptLiteral(sharedTopicMessagesUrl(topic));
  const headers = `{${toScriptLiteral(CLIENT_VERSION_HEADER)}:${toScriptLiteral(CURRENT_VERSION)}}`;

  return [
    `var r=fetch(${url},{credentials:'include',headers:${headers}})`,
    `.then(function(res){if(!res.ok)throw new Error(res.status);return res.json()});`,
    `r.catch(function(){});`,
    `window.__LOBE_SHARED_TOPIC_MESSAGES__={response:r,shareId:${toScriptLiteral(topic.shareId)}};`,
  ].join('');
};

const takeDocumentSharedTopicMessages = (shareId: string) => {
  const started = window.__LOBE_SHARED_TOPIC_MESSAGES__;
  if (started?.shareId !== shareId) return;

  delete window.__LOBE_SHARED_TOPIC_MESSAGES__;

  return started.response.then((body) =>
    toMessageListPage(
      superjson.deserialize<RoundCursorQueryResult>(
        (body as { result: { data: SuperJSONResult } }).result.data,
      ),
    ),
  );
};

/**
 * Hand the messages the document carries to the list, so it paints without
 * waiting for its own read: the embedded first rounds when reading forward,
 * else the newest page the document's script started. Taken once: a later
 * navigation's list reads for itself.
 */
export const primeSharedTopicMessages = (
  topic: SharedTopicTarget,
  { firstPage, messageReadMode }: SharedTopicFirstPage,
) => {
  if (messageReadMode === 'forward') {
    if (firstPage)
      primeForwardMessagePage(toSharedConversationContext(topic, 'forward'), firstPage);
    return;
  }

  const page = takeDocumentSharedTopicMessages(topic.shareId);
  if (!page) return;

  primeMessageListPage(toSharedConversationContext(topic), page);
};

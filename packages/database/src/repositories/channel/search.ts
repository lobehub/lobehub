import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';

import { agents, channelMessages, channelThreads, users } from '../../schemas';
import type { Transaction } from '../../type';
import { ilikeContains } from '../../utils/like';
import { notTrashed } from '../../utils/softDelete';
import { publicMessage, publicMessageColumns } from './view';

export const CHANNEL_SEARCH_MAX_LIMIT = 50;
/** Characters of context kept on each side of the first match. */
const SNIPPET_CONTEXT = 80;

export interface ChannelSearchOptions {
  /** Only messages older than this sequence; pass the last result's to read the next page. */
  before?: number;
  limit?: number;
  query: string;
}

/** Whitespace-separated words; a message matches when it contains every one of them. */
export const channelSearchTerms = (query: string) =>
  [...new Set(query.trim().split(/\s+/).filter(Boolean))].slice(0, 8);

/** A window of the content around the first term found, so a long message stays one row. */
export const channelSearchSnippet = (content: string, terms: string[]) => {
  const flat = content.replaceAll(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const hits = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((at) => at >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(flat.length, at + SNIPPET_CONTEXT * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
};

/**
 * Messages of one Channel, its live Threads included, containing every word of `query`, newest
 * first. The caller has already authorized reading the Channel.
 */
export const searchChannelMessages = async (
  tx: Transaction,
  channelId: string,
  options: ChannelSearchOptions,
) => {
  const terms = channelSearchTerms(options.query);
  if (!terms.length) return { hasMore: false, messages: [] };
  const limit = Math.max(1, Math.min(options.limit ?? 20, CHANNEL_SEARCH_MAX_LIMIT));
  const rows = await tx
    .select({ ...publicMessageColumns, threadMetadata: channelThreads.metadata })
    .from(channelMessages)
    .leftJoin(users, eq(users.id, channelMessages.userId))
    .leftJoin(agents, eq(agents.id, channelMessages.agentId))
    .leftJoin(
      channelThreads,
      and(
        eq(channelThreads.channelId, channelMessages.channelId),
        eq(channelThreads.id, channelMessages.threadId),
      ),
    )
    .where(
      and(
        eq(channelMessages.channelId, channelId),
        // A trashed Thread's messages are out of reach, as when opening it.
        or(isNull(channelMessages.threadId), notTrashed(channelThreads.isDeleted)),
        options.before === undefined ? undefined : lt(channelMessages.sequence, options.before),
        ...terms.map((term) => ilikeContains(channelMessages.content, term)),
      ),
    )
    .orderBy(desc(channelMessages.sequence))
    .limit(limit + 1);
  return {
    hasMore: rows.length > limit,
    messages: rows.slice(0, limit).map(({ threadMetadata, ...row }) => {
      const { author, content, createdAt, id, sequence, threadId } = publicMessage(row, []);
      const title = threadMetadata?.title;
      return {
        author,
        createdAt,
        id,
        sequence,
        snippet: channelSearchSnippet(content, terms),
        threadId,
        threadTitle: typeof title === 'string' && title ? title : null,
      };
    }),
  };
};

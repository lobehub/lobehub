import type { SQL } from 'drizzle-orm';
import { and, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';

import type { FtsSearchBackendFilters } from '../../repositories/ftsSearch';
import { messages, topics } from '../../schemas';
import { sanitizeBm25Query } from '../../utils/bm25';
import { inJsonStringArray } from '../../utils/inJsonStringArray';
import { searchableMessage } from '../../utils/searchableMessage';
import type { MessageLookupQueries } from './lookup';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';

/**
 * Topic triggers whose `user` turns are written by the system (task runs, cron
 * jobs, evals, goal supervision), not typed by a person. Their assistant turns
 * are still real work and stay searchable. Doc-anchored chat (`document`) is
 * human input and is deliberately absent.
 */
export const AUTOMATED_PROMPT_TOPIC_TRIGGERS = [
  'cron',
  'eval',
  'goal_supervision',
  'task',
  'task_manager',
];

export const MESSAGE_KEYWORD_SEARCH_MAX_LIMIT = 100;

/**
 * Requested size of the external candidate pool (Elasticsearch, `pg_like`).
 * Retrieval is ranked by relevance and filtered here, so an unbounded pool
 * would walk every match on each page; the time window is pushed into the
 * provider so the bound applies to an already narrowed set.
 */
export const MESSAGE_KEYWORD_SEARCH_CANDIDATE_POOL = 1000;

const DEFAULT_LIMIT = 20;
/** Short lead-in so the match stays visible in a truncated terminal column. */
const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 200;

export interface MessageKeywordSearchParams {
  agentId?: string;
  endDate?: Date;
  /**
   * Case-sensitive whole-term match on top of full-text retrieval: `STAMP`
   * matches "STAMP mode" but not "stamp" or "STAMPED". Whole terms keep the
   * result identical across tokenizing (pg_search, Elasticsearch) and
   * substring (pg_like) providers.
   */
  exact?: boolean;
  /** Keep system-written `user` prompts of automation topics in the results. */
  includeAutomatedPrompts?: boolean;
  keyword: string;
  limit?: number;
  offset?: number;
  roles?: string[];
  startDate?: Date;
  topicId?: string;
}

export interface MessageKeywordSearchItem {
  agentId: string | null;
  contentLength: number;
  createdAt: Date;
  /**
   * Kept so callers can resolve a group-topic hit back to its group route: a
   * group message carries `groupId` instead of `agentId`, so dropping it loses
   * the link (and an agent-only resolver would build the wrong URL).
   */
  groupId: string | null;
  id: string;
  role: string;
  snippet: string;
  threadId: string | null;
  topicId: string | null;
  topicTitle: string | null;
}

export interface MessageKeywordSearchResult {
  hasMore: boolean;
  items: MessageKeywordSearchItem[];
  /**
   * The provider had more matches than the candidate pool holds, so lower-ranked
   * matches were not considered. Narrow the window or scope to see them.
   */
  truncated: boolean;
}

const ASCII_WORD = /\w/;

/**
 * PostgreSQL regex for a case-sensitive whole-term match. A boundary is only
 * required on a side where the term starts or ends with an ASCII word
 * character, so `C++` still matches "C++20" and CJK terms match inside CJK text.
 */
export const exactTermPattern = (term: string) => {
  const escaped = term.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
  const left = ASCII_WORD.test(term[0]) ? '(^|[^A-Za-z0-9_])' : '';
  const right = ASCII_WORD.test(term.at(-1)!) ? '([^A-Za-z0-9_]|$)' : '';
  return `${left}${escaped}${right}`;
};

/**
 * Candidate-side narrowing. Every filter re-applied after hydration that the
 * index can express goes here, so a bounded pool is cut inside the caller's
 * scope rather than across all of their messages. The agent filter rides on
 * `topicScope`, which keeps legacy rows without `agent_id` for the
 * authoritative session-aware check in PostgreSQL.
 */
const candidateFilters = ({
  agentId,
  endDate,
  roles,
  startDate,
  topicId,
}: Pick<
  MessageKeywordSearchParams,
  'agentId' | 'endDate' | 'roles' | 'startDate' | 'topicId'
>): FtsSearchBackendFilters => ({
  ...((startDate || endDate) && {
    timeRange: { end: endDate, field: 'createdAt', start: startDate },
  }),
  ...(agentId && { topicScope: { agentId } }),
  ...((roles?.length || topicId) && {
    messageScope: { ...(roles?.length && { roles }), ...(topicId && { topicId }) },
  }),
});

/**
 * A window of `content` around the first keyword occurrence, whitespace
 * collapsed. Falls back to the first query term, then to the head of the text.
 */
export const buildMessageSnippet = (content: string, keyword: string, exact?: boolean) => {
  const haystack = exact ? content : content.toLowerCase();
  const needles = [keyword.trim(), ...keyword.trim().split(/\s+/)].filter(Boolean);
  let index = -1;
  let length = 0;
  for (const needle of needles) {
    index = haystack.indexOf(exact ? needle : needle.toLowerCase());
    if (index !== -1) {
      length = needle.length;
      break;
    }
  }

  const start = index === -1 ? 0 : Math.max(0, index - SNIPPET_BEFORE);
  const end = index === -1 ? SNIPPET_BEFORE + SNIPPET_AFTER : index + length + SNIPPET_AFTER;
  const body = content.slice(start, end).replaceAll(/\s+/g, ' ').trim();

  return `${start > 0 ? '…' : ''}${body}${end < content.length ? '…' : ''}`;
};

/**
 * Filtered, paginated keyword search for callers that read history rather than
 * render a command palette (CLI, agents). Unlike `queryByKeyword` it returns a
 * lean projection with the parent topic title and a match snippet.
 */
export class MessageKeywordSearchQueries extends MessageScope {
  private lookups: MessageLookupQueries;

  constructor(args: MessageScopeArgs, deps: { lookups: MessageLookupQueries }) {
    super(...args);
    this.lookups = deps.lookups;
  }

  searchByKeyword = async ({
    agentId,
    endDate,
    exact,
    includeAutomatedPrompts,
    keyword,
    limit = DEFAULT_LIMIT,
    offset = 0,
    roles,
    startDate,
    topicId,
  }: MessageKeywordSearchParams): Promise<MessageKeywordSearchResult> => {
    const text = keyword.trim();
    if (!text) return { hasMore: false, items: [], truncated: false };

    const pageSize = Math.min(Math.max(limit, 1), MESSAGE_KEYWORD_SEARCH_MAX_LIMIT);

    const candidateResult = this.ftsSearchCandidateSource?.ftsSearchCandidateEnabled
      ? await this.ftsSearchCandidateSource.ftsSearchCandidates({
          entity: 'messages',
          filters: candidateFilters({ agentId, endDate, roles, startDate, topicId }),
          pagination: { limit: MESSAGE_KEYWORD_SEARCH_CANDIDATE_POOL },
          query: { fields: ['content'], text },
        })
      : undefined;
    const candidateIds = candidateResult?.candidates.map(({ id }) => id);
    if (candidateIds?.length === 0) return { hasMore: false, items: [], truncated: false };
    // Providers over-fetch past the requested pool size, so its nominal size
    // says nothing; only a provider total above what came back means the
    // cutoff actually dropped lower-ranked matches.
    const truncated = candidateResult
      ? candidateResult.total > candidateResult.candidates.length
      : false;

    const conditions: (SQL | undefined)[] = [
      this.ownership(),
      searchableMessage(),
      candidateIds
        ? inJsonStringArray(messages.id, candidateIds)
        : sql`${messages.content} @@@ ${sanitizeBm25Query(text)}`,
      exact ? sql`${messages.content} ~ ${exactTermPattern(text)}` : undefined,
      startDate ? gte(messages.createdAt, startDate) : undefined,
      endDate ? lte(messages.createdAt, endDate) : undefined,
      roles?.length ? inArray(messages.role, roles) : undefined,
      topicId ? eq(messages.topicId, topicId) : undefined,
      agentId ? await this.lookups.buildAgentCondition(agentId) : undefined,
      includeAutomatedPrompts
        ? undefined
        : or(
            ne(messages.role, 'user'),
            isNull(topics.trigger),
            notInArray(topics.trigger, AUTOMATED_PROMPT_TOPIC_TRIGGERS),
          ),
    ];

    const rows = await this.db
      .select({
        agentId: messages.agentId,
        content: messages.content,
        createdAt: messages.createdAt,
        groupId: messages.groupId,
        id: messages.id,
        role: messages.role,
        summary: messages.summary,
        threadId: messages.threadId,
        topicId: messages.topicId,
        topicTitle: topics.title,
      })
      .from(messages)
      .leftJoin(topics, eq(messages.topicId, topics.id))
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(pageSize + 1)
      .offset(Math.max(offset, 0));

    return {
      truncated,
      hasMore: rows.length > pageSize,
      items: rows.slice(0, pageSize).map(({ content, summary, ...row }) => {
        const body = content || summary || '';
        return {
          ...row,
          contentLength: body.length,
          snippet: buildMessageSnippet(body, text, exact),
        };
      }),
    };
  };
}

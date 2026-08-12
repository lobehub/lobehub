import { LIBRARY_HIDDEN_FILE_SOURCES } from '@lobechat/types';
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
  type SQLWrapper,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import {
  agents,
  chatGroups,
  DOCUMENT_FOLDER_TYPE,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  topics,
  userMemories,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { sanitizeBm25Query } from '../../utils/bm25';
import { normalizeInboxAgentMeta, normalizeInboxAgentTitle } from '../../utils/inboxAgent';
import { buildWorkspaceWhere } from '../../utils/workspace';

export type SearchResultType =
  | 'page'
  | 'pageContent'
  | 'agent'
  | 'topic'
  | 'chatGroup'
  | 'file'
  | 'folder'
  | 'memory'
  | 'message'
  | 'mcp'
  | 'plugin'
  | 'communityAgent'
  | 'knowledgeBase';

export interface BaseSearchResult {
  // 1=exact, 2=prefix, 3=contains
  createdAt: Date;
  description?: string | null;
  id: string;
  relevance: number;
  title: string;
  type: SearchResultType;
  updatedAt: Date;
}

export interface PageSearchResult extends BaseSearchResult {
  id: string;
  type: 'page';
}

export interface PageContentSearchResult extends BaseSearchResult {
  id: string;
  type: 'pageContent';
}

export interface AgentSearchResult extends BaseSearchResult {
  avatar: string | null;
  backgroundColor: string | null;
  slug: string | null;
  tags: string[];
  type: 'agent';
}

export interface ChatGroupSearchResult extends BaseSearchResult {
  avatar: string | null;
  backgroundColor: string | null;
  type: 'chatGroup';
}

export interface TopicSearchResult extends BaseSearchResult {
  agent: {
    avatar: string | null;
    backgroundColor: string | null;
    title: string | null;
  } | null;
  agentId: string | null;
  favorite: boolean | null;
  groupId: string | null;
  sessionId: string | null;
  type: 'topic';
}

export interface FileSearchResult extends BaseSearchResult {
  fileType: string;
  knowledgeBaseId: string | null;
  name: string;
  size: number;
  type: 'file';
  url: string | null;
}

export interface FolderSearchResult extends BaseSearchResult {
  knowledgeBaseId: string | null;
  slug: string | null;
  type: 'folder';
}

export interface MessageSearchResult extends BaseSearchResult {
  agentId: string | null;
  content: string;
  groupId: string | null;
  model: string | null;
  role: string;
  topicId: string | null;
  type: 'message';
}

export interface MemorySearchResult extends BaseSearchResult {
  memoryLayer: string | null;
  type: 'memory';
}

export interface MCPSearchResult extends BaseSearchResult {
  author: string;
  avatar?: string | null;
  category?: string | null;
  connectionType?: 'http' | 'stdio' | null;
  identifier: string;
  installCount?: number | null;
  isFeatured?: boolean | null;
  isValidated?: boolean | null;
  tags?: string[] | null;
  type: 'mcp';
}

export interface PluginSearchResult extends BaseSearchResult {
  author: string;
  avatar?: string | null;
  category?: string | null;
  identifier: string;
  tags?: string[] | null;
  type: 'plugin';
}

export interface KnowledgeBaseSearchResult extends BaseSearchResult {
  avatar: string | null;
  type: 'knowledgeBase';
}

/**
 * BM25 hit for KB-scoped documents used by chunkRouter.semanticSearchForChat.
 * Covers both inline `custom/document` pages and file-backed documents
 * (e.g. parsed PDFs) joined through `knowledge_base_files`.
 *
 * `fileId` is present when the hit comes from a parsed-file document, letting
 * the agent fetch the original via readKnowledge with either docs_* or file_*.
 * `relevance` is normalized to [1, 3] (lower = better, matches BaseSearchResult semantics).
 */
export interface KnowledgeBaseDocumentHit {
  documentId: string;
  fileId?: string;
  knowledgeBaseId: string;
  relevance: number;
  snippet: string;
  title: string;
  updatedAt: Date;
}

export interface AssistantSearchResult extends BaseSearchResult {
  author: string;
  avatar?: string | null;
  homepage?: string | null;
  identifier: string;
  tags?: string[] | null;
  type: 'communityAgent';
}

export type SearchResult =
  | PageSearchResult
  | PageContentSearchResult
  | AgentSearchResult
  | ChatGroupSearchResult
  | TopicSearchResult
  | FileSearchResult
  | FolderSearchResult
  | MessageSearchResult
  | MemorySearchResult
  | MCPSearchResult
  | PluginSearchResult
  | AssistantSearchResult
  | KnowledgeBaseSearchResult;

export interface SearchOptions {
  agentId?: string;
  contextType?: 'agent' | 'resource' | 'page';
  limitPerType?: number;
  offset?: number;
  query: string;
  type?: SearchResultType;
}

/**
 * Topics and messages are ordered by recency rather than BM25 score, so we fetch
 * a larger candidate pool first (most relevant matches), then keep the most recent
 * ones. This prevents newly created/updated items from being buried under older
 * high-scoring matches that would otherwise fill the small per-type limit.
 */
const RECENCY_CANDIDATE_MULTIPLIER = 4;

/**
 * Every query here is shaped as "inner single-table BM25 scan → outer enrichment",
 * because ParadeDB only picks its TopN custom scan (`TopNScanExecState`, which
 * visits a handful of heap rows) when the scan node itself carries the whole
 * `ORDER BY paradedb.score() LIMIT n`. Two things break that:
 *
 * 1. A qual over a column that is not in the BM25 index — `workspace_id` is the
 *    one that matters here. The plan degrades to a plain index scan that scores
 *    and sorts the *entire* match set — on an account with a long message
 *    history that turns a sub-second query into a multi-minute one, fetching
 *    tens of thousands of heap rows instead of 10.
 * 2. A JOIN sitting between the scan and the `ORDER BY … LIMIT` — that alone
 *    downgrades messages/topics/files to `NormalScanExecState` even without any
 *    workspace qual.
 *
 * So joins always live outside the scan, and the ownership predicate is split by
 * `liftsWorkspaceFilter` below.
 *
 * On top of the plan degradation, production pg_search (0.15.26) has a scoring
 * defect that makes any non-indexed qual inside the scan strictly worse than
 * slow: `paradedb.score()` returns NULL for *every* row of the statement
 * (fixed in v0.17.0, see neondatabase/neon#12853). `ORDER BY score DESC` over
 * an all-NULL column is an arbitrary order, and `mapScoresToRelevance` maps it
 * to a flat relevance of 3. So a non-indexed qual inside the scan does not
 * merely cost TopN — it silently breaks ranking. That is why no such qual is
 * ever allowed back inside, and why falling back to the inline-exact query is
 * not an option: the "exact" query is the broken one.
 *
 * `agent_id` is not a BM25 field either, so the agent-scoped variants of
 * `searchMessages` / `searchTopics` (the command menu passes the active agent)
 * lift it above the scan the same way, over-fetching through a dedicated
 * candidate pool (`AGENT_SCOPE_CANDIDATE_POOL`) — but only while the scan's
 * score ordering is real (see `liftsAgentFilter`): trading the exact inline
 * predicate for a score-ordered pool is unsound when the scores backing that
 * order are NULL. Indexing the column instead is tracked with the other
 * missing fast fields.
 *
 * Indexing the column is tracked with the other missing fast fields.
 */
const WORKSPACE_FILTER_CANDIDATE_MULTIPLIER = 5;

/**
 * Candidate pool for the inner scan when the agent filter is lifted above it.
 *
 * `agent_id` is far more selective than the ownership predicate — a single
 * agent can hold well under 1% of an account's matches — so the pool has to be
 * much deeper than the workspace one for small agents to survive the cut. The
 * agent-scoped caller needs ≥ 24 rows to fill its per-type limit (limit 6 ×
 * `RECENCY_CANDIDATE_MULTIPLIER`); measured on a 60k-match account, a pool of
 * 20k keeps ~50 rows for an agent holding 0.32% of matches, while the TopN
 * scan's cost stays nearly flat as the pool grows (6ms at 500 → 11ms at 20k).
 */
const AGENT_SCOPE_CANDIDATE_POOL = 20_000;

/**
 * Floor for the personal-mode candidate pool. Rows dropped by the lifted
 * `workspace_id IS NULL` check eat into the per-type limit, so an account with
 * many workspace rows could otherwise come up short — with a pool of 60 an
 * adversarial mix (5k high-scoring workspace rows vs 20 low-scoring personal
 * ones) returned 0 of 12 rows.
 *
 * A generous pool is what makes that a non-issue, and it is measurably free:
 * once the scan is TopN, the pool size barely registers (same dataset, full
 * payload: 60 rows → 0.53s, 1000 → 0.46s, 2000 → 0.46s). The tantivy scan
 * dominates; the extra heap fetches do not.
 */
const WORKSPACE_FILTER_MIN_CANDIDATES = 500;

/**
 * Flip to `true` once every BM25 index used by this repo carries `workspace_id`
 * as a fast keyword field. pg_search then pushes `workspace_id IS
 * NULL` down as `must_not: exists(workspace_id)` and `workspace_id = ?` as a
 * `term`, so the ownership predicate can stay inline and personal search becomes
 * exact again (no candidate over-fetch, no dropped rows) while workspace-mode
 * search gets TopN for free.
 */
const WORKSPACE_ID_IN_BM25_INDEX = false;

interface WorkspaceScopedColumns {
  userId: AnyPgColumn;
  visibility?: AnyPgColumn;
  workspaceId: AnyPgColumn;
}

/**
 * Search Repository - provides unified search across Agents, Topics, and Files
 */
export class SearchRepo {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private get scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  /**
   * Whether the `workspace_id IS NULL` half of the personal-mode ownership
   * predicate has to be evaluated above the BM25 scan.
   *
   * Only personal mode gets this treatment: it still keeps `user_id = ?` inside
   * the scan (a fast field, so ParadeDB pushes it down), which bounds the
   * candidate pool to the caller's own rows and makes over-fetching a sound
   * approximation. Workspace mode has no such pushdown-able owner column — its
   * rows are a tiny slice of a global TopN — so lifting the filter there would
   * silently return nothing. It keeps the exact inline predicate and stays on
   * the slow plan until `workspace_id` becomes a fast keyword field in the BM25 index.
   */
  private get liftsWorkspaceFilter() {
    return !WORKSPACE_ID_IN_BM25_INDEX && !this.workspaceId;
  }

  /**
   * Whether the agent filter can be lifted above the BM25 scan.
   *
   * Lifting swaps the exact inline predicate for a score-ordered candidate
   * pool, which is only sound while the scan's `ORDER BY paradedb.score()` is
   * real. Personal mode qualifies: its scan keeps only pushdown-able quals, so
   * scores are valid and the pool is genuinely the top-N matches. Workspace
   * mode does not (until `workspace_id` becomes a fast field in the BM25 index): its
   * inline `workspace_id` qual NULLs the whole score column on pg_search
   * 0.15.26, so a pool cut on that ordering would be an arbitrary slice that
   * silently drops agent rows. It keeps `agent_id` inline next to
   * `workspace_id` instead — exact, on the already-degraded plan.
   */
  private get liftsAgentFilter() {
    return WORKSPACE_ID_IN_BM25_INDEX || !this.workspaceId;
  }

  /** Ownership predicate that is safe to keep inside the BM25 scan. */
  private scanScopeWhere(cols: WorkspaceScopedColumns): SQL {
    if (!this.liftsWorkspaceFilter) return buildWorkspaceWhere(this.scope, cols);

    return eq(cols.userId, this.userId) as SQL;
  }

  /** Remainder of the ownership predicate, applied above the BM25 scan. */
  private liftedScopeWhere(workspaceIdColumn: SQLWrapper): SQL | undefined {
    return this.liftsWorkspaceFilter ? (isNull(workspaceIdColumn) as SQL) : undefined;
  }

  /**
   * Candidate pool for the inner scan. When the workspace filter is lifted, rows
   * dropped above the scan would otherwise shrink the result set, so over-fetch.
   * Personal search stays exact unless more than `WORKSPACE_FILTER_MIN_CANDIDATES`
   * of the account's workspace rows outscore its personal matches.
   */
  private scanCandidateLimit(limit: number) {
    if (!this.liftsWorkspaceFilter) return limit;

    return Math.max(limit * WORKSPACE_FILTER_CANDIDATE_MULTIPLIER, WORKSPACE_FILTER_MIN_CANDIDATES);
  }

  /**
   * Search across agents, topics, files, and pages
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, type, limitPerType = 5, agentId, contextType } = options;

    // Early return for empty query
    if (!query || query.trim() === '') return [];

    const trimmedQuery = query.trim();

    // Context-aware limits: prioritize relevant types based on context
    const limits = this.calculateLimits(limitPerType, type, agentId, contextType);

    // Run searches in parallel for better performance
    const searchPromises: Promise<SearchResult[]>[] = [];

    if ((!type || type === 'agent') && limits.agent > 0) {
      searchPromises.push(this.searchAgents(trimmedQuery, limits.agent));
    }
    if ((!type || type === 'chatGroup') && limits.chatGroup > 0) {
      searchPromises.push(this.searchChatGroups(trimmedQuery, limits.chatGroup));
    }
    if ((!type || type === 'topic') && limits.topic > 0) {
      searchPromises.push(this.searchTopics(trimmedQuery, limits.topic, agentId));
    }
    if ((!type || type === 'message') && limits.message > 0) {
      searchPromises.push(this.searchMessages(trimmedQuery, limits.message, agentId));
    }
    if ((!type || type === 'file') && limits.file > 0) {
      searchPromises.push(this.searchFiles(trimmedQuery, limits.file));
    }
    if ((!type || type === 'folder') && limits.folder > 0) {
      searchPromises.push(this.searchFolders(trimmedQuery, limits.folder));
    }
    if ((!type || type === 'page') && limits.page > 0) {
      searchPromises.push(this.searchPages(trimmedQuery, limits.page));
    }
    if ((!type || type === 'memory') && limits.memory > 0) {
      searchPromises.push(this.searchMemories(trimmedQuery, limits.memory));
    }
    if ((!type || type === 'knowledgeBase') && limits.knowledgeBase > 0) {
      searchPromises.push(this.searchKnowledgeBases(trimmedQuery, limits.knowledgeBase));
    }

    const results = await Promise.all(searchPromises);

    // Each search method already returns its results in the intended display order
    // (topics/messages by recency, other types by BM25 score). The command palette
    // groups results by type, so we only need to preserve each type's internal order
    // here rather than re-sorting the merged list by relevance.
    return results.flat();
  }

  /**
   * Calculate result limits based on context
   */
  private calculateLimits(
    baseLimit: number,
    type?: SearchResultType,
    agentId?: string,
    contextType?: 'agent' | 'resource' | 'page',
  ): {
    agent: number;
    chatGroup: number;
    file: number;
    folder: number;
    knowledgeBase: number;
    memory: number;
    message: number;
    page: number;
    pageContent: number;
    topic: number;
  } {
    // If type filter is specified, use full limit for that type
    if (type) {
      return {
        agent: type === 'agent' ? baseLimit : 0,
        chatGroup: type === 'chatGroup' ? baseLimit : 0,
        file: type === 'file' ? baseLimit : 0,
        folder: type === 'folder' ? baseLimit : 0,
        knowledgeBase: type === 'knowledgeBase' ? baseLimit : 0,
        memory: type === 'memory' ? baseLimit : 0,
        message: type === 'message' ? baseLimit : 0,
        page: type === 'page' ? baseLimit : 0,
        pageContent: type === 'pageContent' ? baseLimit : 0,
        topic: type === 'topic' ? baseLimit : 0,
      };
    }

    // Page context: expand pages to 6, limit others to 3
    if (contextType === 'page') {
      return {
        agent: 3,
        chatGroup: 3,
        file: 3,
        folder: 3,
        knowledgeBase: 3,
        memory: 3,
        message: 3,
        page: 6,
        pageContent: 0,
        topic: 3,
      };
    }

    // Resource context: expand files and folders to 6, limit others to 3
    if (contextType === 'resource') {
      return {
        agent: 3,
        chatGroup: 3,
        file: 6,
        folder: 6,
        knowledgeBase: 6,
        memory: 3,
        message: 3,
        page: 3,
        pageContent: 0,
        topic: 3,
      };
    }

    // Agent context: expand topics and messages to 6, limit others to 3
    if (agentId || contextType === 'agent') {
      return {
        agent: 3,
        chatGroup: 3,
        file: 3,
        folder: 3,
        knowledgeBase: 3,
        memory: 3,
        message: 6,
        page: 3,
        pageContent: 0,
        topic: 6,
      };
    }

    // General context: limit all types to 3
    return {
      agent: 3,
      chatGroup: 3,
      file: 3,
      folder: 3,
      knowledgeBase: 3,
      memory: 3,
      message: 3,
      page: 3,
      pageContent: 0,
      topic: 3,
    };
  }

  /**
   * Map BM25 scores to relevance values compatible with the existing sort system.
   * BM25 score (higher=better) → relevance (1-3, lower=better)
   */
  private mapScoresToRelevance<T extends { score: number }>(
    rows: T[],
  ): (Omit<T, 'score'> & { relevance: number })[] {
    if (rows.length === 0) return [];
    const maxScore = Math.max(...rows.map((r) => r.score));
    return rows.map(({ score, ...rest }) => ({
      ...rest,
      relevance: maxScore > 0 ? 1 + 2 * (1 - score / maxScore) : 3,
    }));
  }

  /**
   * Truncate content with ellipsis
   */
  private truncate(content: string | null | undefined, maxLength: number = 200): string | null {
    if (!content) return null;
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  }

  /**
   * Search agents by title, description, slug, tags (BM25)
   */
  private async searchAgents(query: string, limit: number): Promise<AgentSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const hits = this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        createdAt: agents.createdAt,
        description: agents.description,
        id: agents.id,
        name: agents.name,
        score: sql<number>`paradedb.score(${agents.id})`.as('score'),
        slug: agents.slug,
        tags: agents.tags,
        title: agents.title,
        updatedAt: agents.updatedAt,
        workspaceId: agents.workspaceId,
      })
      .from(agents)
      .where(
        and(
          this.scanScopeWhere(agents),
          sql`(${agents.title} @@@ ${bm25Query} OR ${agents.description} @@@ ${bm25Query} OR ${agents.slug} @@@ ${bm25Query} OR ${agents.tags} @@@ ${bm25Query} OR ${agents.systemRole} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${agents.id}) DESC`)
      .limit(this.scanCandidateLimit(limit))
      .as('agent_hits');

    const rows = await this.db
      .select({
        avatar: hits.avatar,
        backgroundColor: hits.backgroundColor,
        createdAt: hits.createdAt,
        description: hits.description,
        id: hits.id,
        score: hits.score,
        slug: hits.slug,
        tags: hits.tags,
        title: hits.title,
        updatedAt: hits.updatedAt,
      })
      .from(hits)
      .where(this.liftedScopeWhere(hits.workspaceId))
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => {
      const meta = normalizeInboxAgentMeta(
        { avatar: row.avatar, title: row.title },
        { slug: row.slug },
      );

      return {
        avatar: meta.avatar,
        backgroundColor: row.backgroundColor,
        createdAt: row.createdAt,
        description: row.description,
        id: row.id,
        relevance: row.relevance,
        slug: row.slug,
        tags: (row.tags as string[]) || [],
        title: meta.title || '',
        type: 'agent' as const,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * Search topics by title, content, description (BM25)
   */
  private async searchTopics(
    query: string,
    limit: number,
    agentId?: string,
  ): Promise<TopicSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const candidateLimit = limit * RECENCY_CANDIDATE_MULTIPLIER;

    const hits = this.db
      .select({
        agentId: topics.agentId,
        content: topics.content,
        createdAt: topics.createdAt,
        favorite: topics.favorite,
        groupId: topics.groupId,
        id: topics.id,
        score: sql<number>`paradedb.score(${topics.id})`.as('score'),
        sessionId: topics.sessionId,
        title: topics.title,
        updatedAt: topics.updatedAt,
        workspaceId: topics.workspaceId,
      })
      .from(topics)
      .where(
        and(
          this.scanScopeWhere(topics),
          agentId && !this.liftsAgentFilter ? eq(topics.agentId, agentId) : undefined,
          sql`(${topics.title} @@@ ${bm25Query} OR ${topics.content} @@@ ${bm25Query} OR ${topics.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${topics.id}) DESC`)
      // `agent_id` is not a BM25 field, so where the scan's score order is real
      // its filter lives above the scan and the pool deepens to compensate. See
      // the scan-shape invariant and `liftsAgentFilter` above.
      .limit(
        agentId && this.liftsAgentFilter
          ? AGENT_SCOPE_CANDIDATE_POOL
          : this.scanCandidateLimit(candidateLimit),
      )
      .as('topic_hits');

    const rows = await this.db
      .select({
        // agents.id is selected as a sentinel: non-null only when the JOIN
        // matched an agent owned by this user. Topics carrying an agentId
        // that points to another user's agent (possible via migrated/crafted
        // data) yield null here, so the renderer falls back to the
        // agent-less subtitle and never surfaces foreign metadata.
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentId: hits.agentId,
        agentMatchedId: agents.id,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentTitle: agents.title,
        content: hits.content,
        createdAt: hits.createdAt,
        favorite: hits.favorite,
        groupId: hits.groupId,
        id: hits.id,
        score: hits.score,
        sessionId: hits.sessionId,
        title: hits.title,
        updatedAt: hits.updatedAt,
      })
      .from(hits)
      .leftJoin(agents, and(eq(hits.agentId, agents.id), buildWorkspaceWhere(this.scope, agents)))
      .where(
        and(
          this.liftedScopeWhere(hits.workspaceId),
          agentId ? eq(hits.agentId, agentId) : undefined,
        ),
      )
      .orderBy(desc(hits.score))
      .limit(candidateLimit);

    return this.mapScoresToRelevance(rows)
      .map((row) => ({
        agent: row.agentMatchedId
          ? {
              avatar: normalizeInboxAgentMeta(
                { avatar: row.agentAvatar, title: row.agentTitle },
                { slug: row.agentSlug },
              ).avatar,
              backgroundColor: row.agentBackgroundColor,
              title: normalizeInboxAgentTitle(row.agentTitle, {
                slug: row.agentSlug,
              }),
            }
          : null,
        agentId: row.agentId,
        createdAt: row.createdAt,
        description: this.truncate(row.content),
        favorite: row.favorite,
        groupId: row.groupId,
        id: row.id,
        relevance: row.relevance,
        sessionId: row.sessionId,
        title: row.title || '',
        type: 'topic' as const,
        updatedAt: row.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Search messages by content (BM25)
   */
  private async searchMessages(
    query: string,
    limit: number,
    agentId?: string,
  ): Promise<MessageSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const candidateLimit = limit * RECENCY_CANDIDATE_MULTIPLIER;

    const hits = this.db
      .select({
        agentId: messages.agentId,
        content: messages.content,
        createdAt: messages.createdAt,
        groupId: messages.groupId,
        id: messages.id,
        model: messages.model,
        role: messages.role,
        score: sql<number>`paradedb.score(${messages.id})`.as('score'),
        topicId: messages.topicId,
        updatedAt: messages.updatedAt,
        workspaceId: messages.workspaceId,
      })
      .from(messages)
      .where(
        and(
          this.scanScopeWhere(messages),
          ne(messages.role, 'tool'),
          agentId && !this.liftsAgentFilter ? eq(messages.agentId, agentId) : undefined,
          sql`${messages.content} @@@ ${bm25Query}`,
        ),
      )
      .orderBy(sql`paradedb.score(${messages.id}) DESC`)
      // `agent_id` is not a BM25 field, so where the scan's score order is real
      // its filter lives above the scan and the pool deepens to compensate. See
      // the scan-shape invariant and `liftsAgentFilter` above.
      .limit(
        agentId && this.liftsAgentFilter
          ? AGENT_SCOPE_CANDIDATE_POOL
          : this.scanCandidateLimit(candidateLimit),
      )
      .as('message_hits');

    const rows = await this.db
      .select({
        agentId: hits.agentId,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentTitle: agents.title,
        content: hits.content,
        createdAt: hits.createdAt,
        groupId: hits.groupId,
        id: hits.id,
        model: hits.model,
        role: hits.role,
        score: hits.score,
        topicId: hits.topicId,
        updatedAt: hits.updatedAt,
      })
      .from(hits)
      .leftJoin(agents, eq(hits.agentId, agents.id))
      .where(
        and(
          this.liftedScopeWhere(hits.workspaceId),
          agentId ? eq(hits.agentId, agentId) : undefined,
        ),
      )
      .orderBy(desc(hits.score))
      .limit(candidateLimit);

    return this.mapScoresToRelevance(rows)
      .map((row) => ({
        agentId: row.agentId,
        content: row.content || '',
        createdAt: row.createdAt,
        description:
          normalizeInboxAgentTitle(row.agentTitle, {
            slug: row.agentSlug,
          }) || 'General Chat',
        groupId: row.groupId,
        id: row.id,
        model: row.model,
        relevance: row.relevance,
        role: row.role,
        title: this.truncate(row.content) || '',
        topicId: row.topicId,
        type: 'message' as const,
        updatedAt: row.updatedAt,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * Search files by name (BM25)
   * Note: ICU tokenizer treats hyphenated/dotted names (e.g. "react-component.jsx") as single tokens,
   * so partial searches like "component" won't match. Full words or prefixes work fine.
   */
  private async searchFiles(query: string, limit: number): Promise<FileSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const hits = this.db
      .select({
        createdAt: files.createdAt,
        fileType: files.fileType,
        id: files.id,
        name: files.name,
        score: sql<number>`paradedb.score(${files.id})`.as('score'),
        size: files.size,
        updatedAt: files.updatedAt,
        url: files.url,
        workspaceId: files.workspaceId,
      })
      .from(files)
      .where(
        and(
          this.scanScopeWhere(files),
          ne(files.fileType, 'custom/document'),
          // Acceptance evidence is hidden from the library, so it must stay out
          // of search too — otherwise a query for "execution" returns hundreds
          // of artifacts the user can't find anywhere else in the UI.
          or(isNull(files.source), notInArray(files.source, LIBRARY_HIDDEN_FILE_SOURCES)),
          sql`${files.name} @@@ ${bm25Query}`,
        ),
      )
      .orderBy(sql`paradedb.score(${files.id}) DESC`)
      .limit(this.scanCandidateLimit(limit))
      .as('file_hits');

    const rows = await this.db
      .select({
        content: documents.content,
        createdAt: hits.createdAt,
        fileType: hits.fileType,
        id: hits.id,
        knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
        name: hits.name,
        score: hits.score,
        size: hits.size,
        updatedAt: hits.updatedAt,
        url: hits.url,
      })
      .from(hits)
      .leftJoin(documents, eq(hits.id, documents.fileId))
      .leftJoin(knowledgeBaseFiles, eq(hits.id, knowledgeBaseFiles.fileId))
      .where(this.liftedScopeWhere(hits.workspaceId))
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => ({
      createdAt: row.createdAt,
      description: this.truncate(row.content),
      fileType: row.fileType,
      id: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      name: row.name,
      relevance: row.relevance,
      size: row.size,
      title: row.name,
      type: 'file' as const,
      updatedAt: row.updatedAt,
      url: row.url,
    }));
  }

  /**
   * Search folders (documents with file_type=DOCUMENT_FOLDER_TYPE) (BM25)
   */
  private async searchFolders(query: string, limit: number): Promise<FolderSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const hits = this.db
      .select({
        createdAt: documents.createdAt,
        description: documents.description,
        filename: documents.filename,
        id: documents.id,
        knowledgeBaseId: documents.knowledgeBaseId,
        score: sql<number>`paradedb.score(${documents.id})`.as('score'),
        slug: documents.slug,
        title: documents.title,
        updatedAt: documents.updatedAt,
        workspaceId: documents.workspaceId,
      })
      .from(documents)
      .where(
        and(
          this.scanScopeWhere(documents),
          eq(documents.fileType, DOCUMENT_FOLDER_TYPE),
          sql`(${documents.title} @@@ ${bm25Query} OR ${documents.slug} @@@ ${bm25Query} OR ${documents.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${documents.id}) DESC`)
      .limit(this.scanCandidateLimit(limit))
      .as('folder_hits');

    const rows = await this.db
      .select({
        createdAt: hits.createdAt,
        description: hits.description,
        filename: hits.filename,
        id: hits.id,
        knowledgeBaseId: hits.knowledgeBaseId,
        score: hits.score,
        slug: hits.slug,
        title: hits.title,
        updatedAt: hits.updatedAt,
      })
      .from(hits)
      .where(this.liftedScopeWhere(hits.workspaceId))
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => {
      const title = row.title || row.filename || 'Untitled';
      return {
        createdAt: row.createdAt,
        description: row.description,
        id: row.id,
        knowledgeBaseId: row.knowledgeBaseId,
        relevance: row.relevance,
        slug: row.slug,
        title,
        type: 'folder' as const,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * Search pages (documents with file_type='custom/document') (BM25)
   */
  private async searchPages(query: string, limit: number): Promise<PageSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const hits = this.db
      .select({
        createdAt: documents.createdAt,
        filename: documents.filename,
        id: documents.id,
        score: sql<number>`paradedb.score(${documents.id})`.as('score'),
        title: documents.title,
        updatedAt: documents.updatedAt,
        workspaceId: documents.workspaceId,
      })
      .from(documents)
      .where(
        and(
          this.scanScopeWhere(documents),
          eq(documents.fileType, 'custom/document'),
          sql`(${documents.title} @@@ ${bm25Query} OR ${documents.slug} @@@ ${bm25Query} OR ${documents.content} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${documents.id}) DESC`)
      .limit(this.scanCandidateLimit(limit))
      .as('page_hits');

    const rows = await this.db
      .select({
        createdAt: hits.createdAt,
        filename: hits.filename,
        id: hits.id,
        score: hits.score,
        title: hits.title,
        updatedAt: hits.updatedAt,
      })
      .from(hits)
      .where(this.liftedScopeWhere(hits.workspaceId))
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => {
      const title = row.title || row.filename || 'Untitled';
      return {
        createdAt: row.createdAt,
        description: null,
        id: row.id,
        relevance: row.relevance,
        title,
        type: 'page' as const,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * KB-scoped BM25 search over documents.
   *
   * Covers two routes to the KB scope, executed as two separate ParadeDB
   * scoring queries that we merge in JS:
   *   - inline pages: `documents.knowledge_base_id` directly references the KB
   *   - file-backed docs (e.g. parsed PDFs): joined through `knowledge_base_files`
   *     via `documents.file_id`
   *
   * Two queries instead of an `OR`-ed WHERE clause because `paradedb.score()`
   * requires a tantivy index scan, and ParadeDB rejects disjunctive shapes
   * spanning bm25 and non-bm25 predicates ("Unsupported query shape").
   *
   * Folder rows (DOCUMENT_FOLDER_TYPE) are excluded — they carry no content.
   *
   * Unlike the command-palette searches above, this one is deliberately left on
   * the plain index-scan plan: `knowledge_base_id` is not in the BM25 index
   * either, so isolating the scan would not buy TopN. The KB filter does bound
   * the match set to one knowledge base (via its btree index), which keeps it
   * workable until `workspace_id` and `visibility` become fast fields in the BM25 index.
   */
  async searchKnowledgeBaseDocuments(
    query: string,
    knowledgeBaseIds: string[],
    limit: number = 20,
  ): Promise<KnowledgeBaseDocumentHit[]> {
    if (!query || query.trim() === '') return [];
    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return [];

    const bm25Query = sanitizeBm25Query(query);

    const matchClause = sql`(${documents.title} @@@ ${bm25Query} OR ${documents.slug} @@@ ${bm25Query} OR ${documents.content} @@@ ${bm25Query})`;
    const folderClause = ne(documents.fileType, DOCUMENT_FOLDER_TYPE);
    const userClause = buildWorkspaceWhere(this.scope, documents);

    const inlineRowsPromise = this.db
      .select({
        content: documents.content,
        fileId: documents.fileId,
        filename: documents.filename,
        id: documents.id,
        knowledgeBaseId: documents.knowledgeBaseId,
        score: sql<number>`paradedb.score(${documents.id})`,
        title: documents.title,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          userClause,
          folderClause,
          inArray(documents.knowledgeBaseId, knowledgeBaseIds),
          matchClause,
        ),
      )
      .orderBy(sql`paradedb.score(${documents.id}) DESC`)
      .limit(limit);

    const fileBackedRowsPromise = this.db
      .select({
        content: documents.content,
        fileId: documents.fileId,
        filename: documents.filename,
        id: documents.id,
        knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
        score: sql<number>`paradedb.score(${documents.id})`,
        title: documents.title,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .innerJoin(
        knowledgeBaseFiles,
        and(
          eq(knowledgeBaseFiles.fileId, documents.fileId),
          buildWorkspaceWhere(this.scope, knowledgeBaseFiles),
          inArray(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseIds),
        ),
      )
      .where(and(userClause, folderClause, matchClause))
      .orderBy(sql`paradedb.score(${documents.id}) DESC`)
      .limit(limit);

    const [inlineRows, fileBackedRows] = await Promise.all([
      inlineRowsPromise,
      fileBackedRowsPromise,
    ]);

    const byId = new Map<string, (typeof inlineRows)[number]>();
    for (const row of [...inlineRows, ...fileBackedRows]) {
      const prev = byId.get(row.id);
      if (!prev || row.score > prev.score) byId.set(row.id, row);
    }
    const merged = Array.from(byId.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return this.mapScoresToRelevance(merged).map((row) => ({
      documentId: row.id,
      fileId: row.fileId ?? undefined,
      knowledgeBaseId: row.knowledgeBaseId ?? '',
      relevance: row.relevance,
      snippet: this.truncate(row.content, 300) ?? '',
      title: row.title || row.filename || 'Untitled',
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Search memories by title, summary, details (BM25)
   *
   * Memories are user-scoped only (no workspace column) and this query joins
   * nothing, so `user_id` is pushed into the tantivy query as-is and the scan
   * already runs as TopN — no subquery isolation needed.
   */
  private async searchMemories(query: string, limit: number): Promise<MemorySearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const rows = await this.db
      .select({
        createdAt: userMemories.createdAt,
        id: userMemories.id,
        memoryLayer: userMemories.memoryLayer,
        score: sql<number>`paradedb.score(${userMemories.id})`,
        summary: userMemories.summary,
        title: userMemories.title,
        updatedAt: userMemories.updatedAt,
      })
      .from(userMemories)
      .where(
        and(
          eq(userMemories.userId, this.userId),
          sql`(${userMemories.title} @@@ ${bm25Query} OR ${userMemories.summary} @@@ ${bm25Query} OR ${userMemories.details} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${userMemories.id}) DESC`)
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => ({
      createdAt: row.createdAt,
      description: this.truncate(row.summary),
      id: row.id,
      memoryLayer: row.memoryLayer,
      relevance: row.relevance,
      title: row.title || 'Untitled Memory',
      type: 'memory' as const,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Search chat groups by title and description (BM25)
   */
  private async searchChatGroups(query: string, limit: number): Promise<ChatGroupSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const hits = this.db
      .select({
        avatar: chatGroups.avatar,
        backgroundColor: chatGroups.backgroundColor,
        createdAt: chatGroups.createdAt,
        description: chatGroups.description,
        id: chatGroups.id,
        score: sql<number>`paradedb.score(${chatGroups.id})`.as('score'),
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
        workspaceId: chatGroups.workspaceId,
      })
      .from(chatGroups)
      .where(
        and(
          this.scanScopeWhere(chatGroups),
          sql`(${chatGroups.title} @@@ ${bm25Query} OR ${chatGroups.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${chatGroups.id}) DESC`)
      .limit(this.scanCandidateLimit(limit))
      .as('chat_group_hits');

    const rows = await this.db
      .select({
        avatar: hits.avatar,
        backgroundColor: hits.backgroundColor,
        createdAt: hits.createdAt,
        description: hits.description,
        id: hits.id,
        score: hits.score,
        title: hits.title,
        updatedAt: hits.updatedAt,
      })
      .from(hits)
      .where(this.liftedScopeWhere(hits.workspaceId))
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => ({
      avatar: row.avatar,
      backgroundColor: row.backgroundColor,
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      relevance: row.relevance,
      title: row.title || '',
      type: 'chatGroup' as const,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Search knowledge bases by name and description (BM25)
   */
  private async searchKnowledgeBases(
    query: string,
    limit: number,
  ): Promise<KnowledgeBaseSearchResult[]> {
    const bm25Query = sanitizeBm25Query(query);

    const hits = this.db
      .select({
        avatar: knowledgeBases.avatar,
        createdAt: knowledgeBases.createdAt,
        description: knowledgeBases.description,
        id: knowledgeBases.id,
        name: knowledgeBases.name,
        score: sql<number>`paradedb.score(${knowledgeBases.id})`.as('score'),
        updatedAt: knowledgeBases.updatedAt,
        workspaceId: knowledgeBases.workspaceId,
      })
      .from(knowledgeBases)
      .where(
        and(
          this.scanScopeWhere(knowledgeBases),
          sql`(${knowledgeBases.name} @@@ ${bm25Query} OR ${knowledgeBases.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${knowledgeBases.id}) DESC`)
      .limit(this.scanCandidateLimit(limit))
      .as('knowledge_base_hits');

    const rows = await this.db
      .select({
        avatar: hits.avatar,
        createdAt: hits.createdAt,
        description: hits.description,
        id: hits.id,
        name: hits.name,
        score: hits.score,
        updatedAt: hits.updatedAt,
      })
      .from(hits)
      .where(this.liftedScopeWhere(hits.workspaceId))
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => ({
      avatar: row.avatar,
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      relevance: row.relevance,
      title: row.name,
      type: 'knowledgeBase' as const,
      updatedAt: row.updatedAt,
    }));
  }
}

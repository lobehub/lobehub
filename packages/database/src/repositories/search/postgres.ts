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
import type {
  AgentSearchResult,
  ChatGroupSearchResult,
  FileSearchResult,
  FolderSearchResult,
  KnowledgeBaseDocumentHit,
  KnowledgeBaseSearchResult,
  MemorySearchResult,
  MessageSearchResult,
  PageSearchResult,
  SearchBackend,
  SearchBackendItem,
  SearchBackendRequest,
  SearchBackendResponse,
  SearchBackendScope,
  TopicSearchResult,
} from './types';

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

/** PostgreSQL/pg_search adapter that preserves the existing query and hydration shape. */
export class PostgresSearchBackend implements SearchBackend {
  readonly key = 'pg_search';

  private callerAgentVisibility?: 'private' | 'public' | null;
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, scope: SearchBackendScope) {
    this.userId = scope.userId;
    this.db = db;
    this.workspaceId = scope.workspaceId;
    this.callerAgentVisibility = scope.callerAgentVisibility;
  }

  private get scope() {
    return {
      callerAgentVisibility: this.callerAgentVisibility,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
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

  async search(request: SearchBackendRequest): Promise<SearchBackendResponse> {
    const query = request.query.text.trim();
    if (!query) return { candidates: [], items: [] };

    const { entity, filters, pagination } = request;
    /** Preserve the public repository's existing behavior: its offset was accepted but not applied. */
    const limit = pagination.limit;

    if (entity === 'agents') return this.searchAgents(query, limit);
    if (entity === 'chatGroups') return this.searchChatGroups(query, limit);
    if (entity === 'topics') return this.searchTopics(query, limit, filters.agentId);
    if (entity === 'messages') return this.searchMessages(query, limit, filters.agentId);
    if (entity === 'files') return this.searchFiles(query, limit, filters.excludeKnowledgeBaseIds);
    if (entity === 'knowledgeBases')
      return this.searchKnowledgeBases(query, limit, filters.excludeKnowledgeBaseIds);
    if (entity === 'userMemories') return this.searchMemories(query, limit);

    if (entity === 'documents') {
      if (filters.documentKind === 'folder')
        return this.searchFolders(query, limit, filters.excludeKnowledgeBaseIds);
      if (filters.documentKind === 'page')
        return this.searchPages(query, limit, filters.excludeKnowledgeBaseIds);
      if (filters.documentKind === 'knowledgeBaseDocument') {
        return this.searchKnowledgeBaseDocuments(query, filters.knowledgeBaseIds ?? [], limit);
      }
    }

    throw new Error(`Unsupported pg_search entity: ${entity}`);
  }

  /**
   * Map BM25 scores to relevance values compatible with the existing sort system.
   * BM25 score (higher=better) → relevance (1-3, lower=better)
   */
  private mapScoresToRelevance<T extends { score: number }>(
    rows: T[],
  ): (T & { relevance: number })[] {
    if (rows.length === 0) return [];
    const maxScore = Math.max(...rows.map((r) => r.score));
    return rows.map((row) => ({
      ...row,
      relevance: maxScore > 0 ? 1 + 2 * (1 - row.score / maxScore) : 3,
    }));
  }

  private buildResponse<T extends { id: string; score: number }, TItem extends SearchBackendItem>(
    rows: T[],
    mapItem: (row: T & { relevance: number }) => TItem,
  ): SearchBackendResponse<TItem> {
    return this.buildScoredResponse(this.mapScoresToRelevance(rows), mapItem);
  }

  private buildScoredResponse<
    T extends { id: string; relevance: number; score: number },
    TItem extends SearchBackendItem,
  >(rows: T[], mapItem: (row: T) => TItem): SearchBackendResponse<TItem> {
    return {
      candidates: rows.map((row) => ({ id: row.id, score: row.score })),
      items: rows.map(mapItem),
    };
  }

  private buildSelectedResponse<
    T extends { id: string; relevance: number; score: number },
    TItem extends SearchBackendItem,
  >(candidates: T[], rows: T[], mapItem: (row: T) => TItem): SearchBackendResponse<TItem> {
    return {
      candidates: candidates.map((row) => ({ id: row.id, score: row.score })),
      items: rows.map(mapItem),
    };
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
  private async searchAgents(
    query: string,
    limit: number,
  ): Promise<SearchBackendResponse<AgentSearchResult>> {
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

    return this.buildResponse(rows, (row) => {
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
  ): Promise<SearchBackendResponse<TopicSearchResult>> {
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

    const scoredRows = this.mapScoresToRelevance(rows);
    const sortedRows = [...scoredRows]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);

    return this.buildSelectedResponse(scoredRows, sortedRows, (row) => ({
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
    }));
  }

  /**
   * Search messages by content (BM25)
   */
  private async searchMessages(
    query: string,
    limit: number,
    agentId?: string,
  ): Promise<SearchBackendResponse<MessageSearchResult>> {
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

    const scoredRows = this.mapScoresToRelevance(rows);
    const sortedRows = [...scoredRows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    return this.buildSelectedResponse(scoredRows, sortedRows, (row) => ({
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
    }));
  }

  /**
   * Search files by name (BM25)
   * Note: ICU tokenizer treats hyphenated/dotted names (e.g. "react-component.jsx") as single tokens,
   * so partial searches like "component" won't match. Full words or prefixes work fine.
   */
  private async searchFiles(
    query: string,
    limit: number,
    excludeKbIds?: string[],
  ): Promise<SearchBackendResponse<FileSearchResult>> {
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
      .where(
        and(
          this.liftedScopeWhere(hits.workspaceId),
          // A file linked to ANY restricted KB is fully hidden (over-hiding
          // beats leaking through a shared membership) — subquery instead of
          // the joined column so multi-KB rows cannot slip through.
          excludeKbIds && excludeKbIds.length > 0
            ? notInArray(
                hits.id,
                this.db
                  .select({ fileId: knowledgeBaseFiles.fileId })
                  .from(knowledgeBaseFiles)
                  .where(inArray(knowledgeBaseFiles.knowledgeBaseId, excludeKbIds)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.buildResponse(rows, (row) => ({
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
  private async searchFolders(
    query: string,
    limit: number,
    excludeKbIds?: string[],
  ): Promise<SearchBackendResponse<FolderSearchResult>> {
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
      .where(
        and(
          this.liftedScopeWhere(hits.workspaceId),
          excludeKbIds && excludeKbIds.length > 0
            ? or(isNull(hits.knowledgeBaseId), notInArray(hits.knowledgeBaseId, excludeKbIds))
            : undefined,
        ),
      )
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.buildResponse(rows, (row) => {
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
  private async searchPages(
    query: string,
    limit: number,
    excludeKbIds?: string[],
  ): Promise<SearchBackendResponse<PageSearchResult>> {
    const bm25Query = sanitizeBm25Query(query);

    const hits = this.db
      .select({
        createdAt: documents.createdAt,
        fileId: documents.fileId,
        filename: documents.filename,
        id: documents.id,
        knowledgeBaseId: documents.knowledgeBaseId,
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
      .where(
        and(
          this.liftedScopeWhere(hits.workspaceId),
          excludeKbIds && excludeKbIds.length > 0
            ? or(isNull(hits.knowledgeBaseId), notInArray(hits.knowledgeBaseId, excludeKbIds))
            : undefined,
          // Parsed-file pages leave `knowledgeBaseId` null — their KB
          // membership lives on `fileId` → `knowledge_base_files`.
          excludeKbIds && excludeKbIds.length > 0
            ? or(
                isNull(hits.fileId),
                notInArray(
                  hits.fileId,
                  this.db
                    .select({ fileId: knowledgeBaseFiles.fileId })
                    .from(knowledgeBaseFiles)
                    .where(inArray(knowledgeBaseFiles.knowledgeBaseId, excludeKbIds)),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.buildResponse(rows, (row) => {
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
  private async searchKnowledgeBaseDocuments(
    query: string,
    knowledgeBaseIds: string[],
    limit: number = 20,
  ): Promise<SearchBackendResponse<KnowledgeBaseDocumentHit>> {
    if (!query || query.trim() === '') return { candidates: [], items: [] };
    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return { candidates: [], items: [] };

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

    return this.buildResponse(merged, (row) => ({
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
  private async searchMemories(
    query: string,
    limit: number,
  ): Promise<SearchBackendResponse<MemorySearchResult>> {
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

    return this.buildResponse(rows, (row) => ({
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
  private async searchChatGroups(
    query: string,
    limit: number,
  ): Promise<SearchBackendResponse<ChatGroupSearchResult>> {
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

    return this.buildResponse(rows, (row) => ({
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
    excludeIds?: string[],
  ): Promise<SearchBackendResponse<KnowledgeBaseSearchResult>> {
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
      .where(
        and(
          this.liftedScopeWhere(hits.workspaceId),
          // Lifted above the BM25 scan (like the scope predicate) so the scan
          // keeps its TopN shape; restricted rows only consume candidate slots.
          excludeIds && excludeIds.length > 0 ? notInArray(hits.id, excludeIds) : undefined,
        ),
      )
      .orderBy(desc(hits.score))
      .limit(limit);

    return this.buildResponse(rows, (row) => ({
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

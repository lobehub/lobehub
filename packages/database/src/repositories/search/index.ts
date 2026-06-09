import { and, eq, inArray, ne, sql } from 'drizzle-orm';

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

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        createdAt: agents.createdAt,
        description: agents.description,
        id: agents.id,
        score: sql<number>`paradedb.score(${agents.id})`,
        slug: agents.slug,
        tags: agents.tags,
        title: agents.title,
        updatedAt: agents.updatedAt,
      })
      .from(agents)
      .where(
        and(
          buildWorkspaceWhere(this.scope, agents),
          sql`(${agents.title} @@@ ${bm25Query} OR ${agents.description} @@@ ${bm25Query} OR ${agents.slug} @@@ ${bm25Query} OR ${agents.tags} @@@ ${bm25Query} OR ${agents.systemRole} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${agents.id}) DESC`)
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => ({
      avatar: row.avatar,
      backgroundColor: row.backgroundColor,
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      relevance: row.relevance,
      slug: row.slug,
      tags: (row.tags as string[]) || [],
      title: row.title || '',
      type: 'agent' as const,
      updatedAt: row.updatedAt,
    }));
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

    const rows = await this.db
      .select({
        // agents.id is selected as a sentinel: non-null only when the JOIN
        // matched an agent owned by this user. Topics carrying an agentId
        // that points to another user's agent (possible via migrated/crafted
        // data) yield null here, so the renderer falls back to the
        // agent-less subtitle and never surfaces foreign metadata.
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentId: topics.agentId,
        agentMatchedId: agents.id,
        agentTitle: agents.title,
        content: topics.content,
        createdAt: topics.createdAt,
        favorite: topics.favorite,
        id: topics.id,
        score: sql<number>`paradedb.score(${topics.id})`,
        sessionId: topics.sessionId,
        title: topics.title,
        updatedAt: topics.updatedAt,
      })
      .from(topics)
      .leftJoin(agents, and(eq(topics.agentId, agents.id), buildWorkspaceWhere(this.scope, agents)))
      .where(
        and(
          buildWorkspaceWhere(this.scope, topics),
          agentId ? eq(topics.agentId, agentId) : undefined,
          sql`(${topics.title} @@@ ${bm25Query} OR ${topics.content} @@@ ${bm25Query} OR ${topics.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${topics.id}) DESC`)
      .limit(limit * RECENCY_CANDIDATE_MULTIPLIER);

    return this.mapScoresToRelevance(rows)
      .map((row) => ({
        agent: row.agentMatchedId
          ? {
              avatar: row.agentAvatar,
              backgroundColor: row.agentBackgroundColor,
              title: row.agentTitle,
            }
          : null,
        agentId: row.agentId,
        createdAt: row.createdAt,
        description: this.truncate(row.content),
        favorite: row.favorite,
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

    const rows = await this.db
      .select({
        agentId: messages.agentId,
        agentTitle: agents.title,
        content: messages.content,
        createdAt: messages.createdAt,
        id: messages.id,
        model: messages.model,
        role: messages.role,
        score: sql<number>`paradedb.score(${messages.id})`,
        topicId: messages.topicId,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .leftJoin(agents, eq(messages.agentId, agents.id))
      .where(
        and(
          buildWorkspaceWhere(this.scope, messages),
          ne(messages.role, 'tool'),
          agentId ? eq(messages.agentId, agentId) : undefined,
          sql`${messages.content} @@@ ${bm25Query}`,
        ),
      )
      .orderBy(sql`paradedb.score(${messages.id}) DESC`)
      .limit(limit * RECENCY_CANDIDATE_MULTIPLIER);

    return this.mapScoresToRelevance(rows)
      .map((row) => ({
        agentId: row.agentId,
        content: row.content || '',
        createdAt: row.createdAt,
        description: row.agentTitle || 'General Chat',
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

    const rows = await this.db
      .select({
        content: documents.content,
        createdAt: files.createdAt,
        fileType: files.fileType,
        id: files.id,
        knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
        name: files.name,
        score: sql<number>`paradedb.score(${files.id})`,
        size: files.size,
        updatedAt: files.updatedAt,
        url: files.url,
      })
      .from(files)
      .leftJoin(documents, eq(files.id, documents.fileId))
      .leftJoin(knowledgeBaseFiles, eq(files.id, knowledgeBaseFiles.fileId))
      .where(
        and(
          buildWorkspaceWhere(this.scope, files),
          ne(files.fileType, 'custom/document'),
          sql`${files.name} @@@ ${bm25Query}`,
        ),
      )
      .orderBy(sql`paradedb.score(${files.id}) DESC`)
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

    const rows = await this.db
      .select({
        createdAt: documents.createdAt,
        description: documents.description,
        filename: documents.filename,
        id: documents.id,
        knowledgeBaseId: documents.knowledgeBaseId,
        score: sql<number>`paradedb.score(${documents.id})`,
        slug: documents.slug,
        title: documents.title,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          buildWorkspaceWhere(this.scope, documents),
          eq(documents.fileType, DOCUMENT_FOLDER_TYPE),
          sql`(${documents.title} @@@ ${bm25Query} OR ${documents.slug} @@@ ${bm25Query} OR ${documents.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${documents.id}) DESC`)
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

    const rows = await this.db
      .select({
        createdAt: documents.createdAt,
        filename: documents.filename,
        id: documents.id,
        score: sql<number>`paradedb.score(${documents.id})`,
        title: documents.title,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          buildWorkspaceWhere(this.scope, documents),
          eq(documents.fileType, 'custom/document'),
          sql`(${documents.title} @@@ ${bm25Query} OR ${documents.slug} @@@ ${bm25Query} OR ${documents.content} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${documents.id}) DESC`)
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

    const rows = await this.db
      .select({
        avatar: chatGroups.avatar,
        backgroundColor: chatGroups.backgroundColor,
        createdAt: chatGroups.createdAt,
        description: chatGroups.description,
        id: chatGroups.id,
        score: sql<number>`paradedb.score(${chatGroups.id})`,
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
      })
      .from(chatGroups)
      .where(
        and(
          buildWorkspaceWhere(this.scope, chatGroups),
          sql`(${chatGroups.title} @@@ ${bm25Query} OR ${chatGroups.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${chatGroups.id}) DESC`)
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

    const rows = await this.db
      .select({
        avatar: knowledgeBases.avatar,
        createdAt: knowledgeBases.createdAt,
        description: knowledgeBases.description,
        id: knowledgeBases.id,
        name: knowledgeBases.name,
        score: sql<number>`paradedb.score(${knowledgeBases.id})`,
        updatedAt: knowledgeBases.updatedAt,
      })
      .from(knowledgeBases)
      .where(
        and(
          buildWorkspaceWhere(this.scope, knowledgeBases),
          sql`(${knowledgeBases.name} @@@ ${bm25Query} OR ${knowledgeBases.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${knowledgeBases.id}) DESC`)
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

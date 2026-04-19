import { and, eq, ne, sql } from 'drizzle-orm';

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
 * Search Repository - provides unified search across Agents, Topics, and Files
 */
export class SearchRepo {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
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

    // Flatten and sort by relevance ASC, then by updatedAt DESC
    return results
      .flat()
      .sort((a, b) => a.relevance - b.relevance || b.updatedAt.getTime() - a.updatedAt.getTime());
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
          eq(agents.userId, this.userId),
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
        agentId: topics.agentId,
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
      .where(
        and(
          eq(topics.userId, this.userId),
          agentId ? eq(topics.agentId, agentId) : undefined,
          sql`(${topics.title} @@@ ${bm25Query} OR ${topics.content} @@@ ${bm25Query} OR ${topics.description} @@@ ${bm25Query})`,
        ),
      )
      .orderBy(sql`paradedb.score(${topics.id}) DESC`)
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => ({
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
    }));
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
          eq(messages.userId, this.userId),
          ne(messages.role, 'tool'),
          agentId ? eq(messages.agentId, agentId) : undefined,
          sql`${messages.content} @@@ ${bm25Query}`,
        ),
      )
      .orderBy(sql`paradedb.score(${messages.id}) DESC`)
      .limit(limit);

    return this.mapScoresToRelevance(rows).map((row) => ({
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
    }));
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
          eq(files.userId, this.userId),
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
          eq(documents.userId, this.userId),
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
          eq(documents.userId, this.userId),
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
          eq(chatGroups.userId, this.userId),
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
          eq(knowledgeBases.userId, this.userId),
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

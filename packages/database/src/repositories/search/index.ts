import { and, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';

import {
  agents,
  documents,
  files,
  knowledgeBaseFiles,
  messages,
  topics,
  userMemories,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export type SearchResultType =
  | 'page'
  | 'pageContent'
  | 'agent'
  | 'topic'
  | 'file'
  | 'folder'
  | 'memory'
  | 'message'
  | 'mcp'
  | 'plugin'
  | 'communityAgent';

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
  | TopicSearchResult
  | FileSearchResult
  | FolderSearchResult
  | MessageSearchResult
  | MemorySearchResult
  | MCPSearchResult
  | PluginSearchResult
  | AssistantSearchResult;

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
    file: number;
    folder: number;
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
        file: type === 'file' ? baseLimit : 0,
        folder: type === 'folder' ? baseLimit : 0,
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
        file: 3,
        folder: 3,
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
        file: 6,
        folder: 6,
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
        file: 3,
        folder: 3,
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
      file: 3,
      folder: 3,
      memory: 3,
      message: 3,
      page: 3,
      pageContent: 0,
      topic: 3,
    };
  }

  /**
   * Calculate relevance score: 1=exact, 2=prefix, 3=contains
   */
  private calculateRelevance(value: string | null | undefined, query: string): number {
    if (!value) return 3;
    const lower = value.toLowerCase();
    const queryLower = query.toLowerCase();
    if (lower === queryLower) return 1;
    if (lower.startsWith(queryLower)) return 2;
    return 3;
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
   * Search agents by title, description, slug, tags
   */
  private async searchAgents(query: string, limit: number): Promise<AgentSearchResult[]> {
    const searchTerm = `%${query}%`;

    const rows = await this.db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.userId, this.userId),
          or(
            ilike(agents.title, searchTerm),
            ilike(sql`COALESCE(${agents.description}, '')`, searchTerm),
            ilike(sql`COALESCE(${agents.slug}, '')`, searchTerm),
            sql`${agents.tags} IS NOT NULL AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(${agents.tags}) AS tag
              WHERE tag ILIKE ${searchTerm}
            )`,
          ),
        ),
      )
      .orderBy(desc(agents.updatedAt))
      .limit(limit);

    return rows.map((row) => ({
      avatar: row.avatar,
      backgroundColor: row.backgroundColor,
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      relevance: this.calculateRelevance(row.title, query),
      slug: row.slug,
      tags: (row.tags as string[]) || [],
      title: row.title || '',
      type: 'agent' as const,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Search topics by title, content, historySummary
   */
  private async searchTopics(
    query: string,
    limit: number,
    agentId?: string,
  ): Promise<TopicSearchResult[]> {
    const searchTerm = `%${query}%`;

    const rows = await this.db
      .select()
      .from(topics)
      .where(
        and(
          eq(topics.userId, this.userId),
          or(
            ilike(sql`COALESCE(${topics.title}, '')`, searchTerm),
            ilike(sql`COALESCE(${topics.content}, '')`, searchTerm),
            ilike(sql`COALESCE(${topics.historySummary}, '')`, searchTerm),
          ),
        ),
      )
      .orderBy(desc(topics.updatedAt))
      .limit(limit);

    return rows.map((row) => {
      // Agent context boosting: current agent's topics get higher priority
      let relevance = this.calculateRelevance(row.title, query);
      if (agentId && row.agentId === agentId) {
        // Boost current agent's topics (0.5-0.7 range)
        relevance = relevance === 1 ? 0.5 : relevance === 2 ? 0.6 : 0.7;
      }

      return {
        agentId: row.agentId,
        createdAt: row.createdAt,
        description: this.truncate(row.content),
        favorite: row.favorite,
        id: row.id,
        relevance,
        sessionId: row.sessionId,
        title: row.title || '',
        type: 'topic' as const,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * Search messages by content
   */
  private async searchMessages(
    query: string,
    limit: number,
    agentId?: string,
  ): Promise<MessageSearchResult[]> {
    const searchTerm = `%${query}%`;

    // Split query into words for multi-word search
    const words = query.split(/\s+/).filter((w) => w.length > 0);

    const wordConditions =
      words.length > 1
        ? or(...words.map((word) => ilike(sql`COALESCE(${messages.content}, '')`, `%${word}%`)))
        : ilike(sql`COALESCE(${messages.content}, '')`, searchTerm);

    const rows = await this.db
      .select({
        agentId: messages.agentId,
        agentTitle: agents.title,
        content: messages.content,
        createdAt: messages.createdAt,
        id: messages.id,
        model: messages.model,
        role: messages.role,
        topicId: messages.topicId,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .leftJoin(agents, eq(messages.agentId, agents.id))
      .where(and(eq(messages.userId, this.userId), ne(messages.role, 'tool'), wordConditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return rows.map((row) => {
      // Agent context boosting
      let relevance = this.calculateRelevance(row.content, query);
      if (agentId && row.agentId === agentId) {
        relevance = relevance === 1 ? 0.5 : relevance === 2 ? 0.6 : 0.7;
      }

      return {
        agentId: row.agentId,
        content: row.content || '',
        createdAt: row.createdAt,
        description: row.agentTitle || 'General Chat',
        id: row.id,
        model: row.model,
        relevance,
        role: row.role,
        title: this.truncate(row.content) || '',
        topicId: row.topicId,
        type: 'message' as const,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * Search files by name
   */
  private async searchFiles(query: string, limit: number): Promise<FileSearchResult[]> {
    const searchTerm = `%${query}%`;

    const rows = await this.db
      .select({
        content: documents.content,
        createdAt: files.createdAt,
        fileType: files.fileType,
        id: files.id,
        knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
        name: files.name,
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
          ilike(files.name, searchTerm),
        ),
      )
      .orderBy(desc(files.updatedAt))
      .limit(limit);

    return rows.map((row) => ({
      createdAt: row.createdAt,
      description: this.truncate(row.content),
      fileType: row.fileType,
      id: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      name: row.name,
      relevance: this.calculateRelevance(row.name, query),
      size: row.size,
      title: row.name,
      type: 'file' as const,
      updatedAt: row.updatedAt,
      url: row.url,
    }));
  }

  /**
   * Search folders (documents with file_type='custom/folder')
   */
  private async searchFolders(query: string, limit: number): Promise<FolderSearchResult[]> {
    const searchTerm = `%${query}%`;

    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.userId, this.userId),
          eq(documents.fileType, 'custom/folder'),
          or(
            ilike(sql`COALESCE(${documents.title}, '')`, searchTerm),
            ilike(sql`COALESCE(${documents.filename}, '')`, searchTerm),
            ilike(sql`COALESCE(${documents.description}, '')`, searchTerm),
          ),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(limit);

    return rows.map((row) => {
      const title = row.title || row.filename || 'Untitled';
      return {
        createdAt: row.createdAt,
        description: row.description,
        id: row.id,
        knowledgeBaseId: row.knowledgeBaseId,
        relevance: this.calculateRelevance(title, query),
        slug: row.slug,
        title,
        type: 'folder' as const,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * Search pages (documents with file_type='custom/document')
   */
  private async searchPages(query: string, limit: number): Promise<PageSearchResult[]> {
    const searchTerm = `%${query}%`;

    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.userId, this.userId),
          eq(documents.fileType, 'custom/document'),
          or(
            ilike(sql`COALESCE(${documents.title}, '')`, searchTerm),
            ilike(sql`COALESCE(${documents.filename}, '')`, searchTerm),
          ),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(limit);

    return rows.map((row) => {
      const title = row.title || row.filename || 'Untitled';
      return {
        createdAt: row.createdAt,
        description: null,
        id: row.id,
        relevance: this.calculateRelevance(title, query),
        title,
        type: 'page' as const,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * Search memories by title, summary, details
   */
  private async searchMemories(query: string, limit: number): Promise<MemorySearchResult[]> {
    const searchTerm = `%${query}%`;

    const rows = await this.db
      .select()
      .from(userMemories)
      .where(
        and(
          eq(userMemories.userId, this.userId),
          or(
            ilike(sql`COALESCE(${userMemories.title}, '')`, searchTerm),
            ilike(sql`COALESCE(${userMemories.summary}, '')`, searchTerm),
            ilike(sql`COALESCE(${userMemories.details}, '')`, searchTerm),
          ),
        ),
      )
      .orderBy(desc(userMemories.updatedAt))
      .limit(limit);

    return rows.map((row) => ({
      createdAt: row.createdAt,
      description: this.truncate(row.summary),
      id: row.id,
      memoryLayer: row.memoryLayer,
      relevance: this.calculateRelevance(row.title, query),
      title: row.title || 'Untitled Memory',
      type: 'memory' as const,
      updatedAt: row.updatedAt,
    }));
  }
}

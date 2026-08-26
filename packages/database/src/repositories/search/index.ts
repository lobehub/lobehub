import type { LobeChatDatabase } from '../../type';
import { PostgresSearchBackend } from './postgres';
import type {
  DatabaseSearchResult,
  KnowledgeBaseDocumentHit,
  SearchBackendFilters,
  SearchBackendMeasurement,
  SearchBackendRequest,
  SearchBackendResponse,
  SearchBackendScope,
  SearchOptions,
  SearchRepoOptions,
  SearchResult,
  SearchResultType,
} from './types';

export { PostgresSearchBackend } from './postgres';
export * from './types';

interface SearchLimits {
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
}

/**
 * Provider-neutral search facade. Backends own candidate retrieval and final
 * PostgreSQL hydration, while this class preserves the public repository API.
 */
export class SearchRepo {
  private backend: NonNullable<SearchRepoOptions['backend']>;
  private onMeasurement?: SearchRepoOptions['onMeasurement'];
  private scope: SearchBackendScope;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    callerAgentVisibility?: 'private' | 'public' | null,
    options: SearchRepoOptions = {},
  ) {
    this.scope = { callerAgentVisibility, userId, workspaceId };
    this.backend = options.backend ?? new PostgresSearchBackend(db, this.scope);
    this.onMeasurement = options.onMeasurement;
  }

  private createRequest(
    entity: SearchBackendRequest['entity'],
    query: string,
    limit: number,
    filters: SearchBackendFilters = {},
    offset: number = 0,
  ): SearchBackendRequest {
    return {
      entity,
      filters,
      pagination: { limit, offset },
      query: { text: query },
      scope: this.scope,
    };
  }

  private async execute(request: SearchBackendRequest): Promise<SearchBackendResponse> {
    const startedAt = Date.now();

    try {
      const response = await this.backend.search(request);
      this.recordMeasurement({
        candidates: response.candidates,
        durationMs: Date.now() - startedAt,
        provider: this.backend.key,
        request,
        status: 'success',
      });
      return response;
    } catch (error) {
      this.recordMeasurement({
        durationMs: Date.now() - startedAt,
        error,
        provider: this.backend.key,
        request,
        status: 'error',
      });
      throw error;
    }
  }

  /** Measurement failures must never change the selected provider's result or error. */
  private recordMeasurement(measurement: SearchBackendMeasurement) {
    try {
      this.onMeasurement?.(measurement);
    } catch (error) {
      console.error('[SearchRepo] measurement hook failed', error);
    }
  }

  /** Search across the database-backed product result types. */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, type, limitPerType = 5, agentId, contextType, offset = 0 } = options;
    if (!query || query.trim() === '') return [];

    const trimmedQuery = query.trim();
    const limits = this.calculateLimits(limitPerType, type, agentId, contextType);
    const excludeKnowledgeBaseIds = options.excludeKnowledgeBaseIds ?? [];
    const searches: Promise<SearchBackendResponse>[] = [];

    if ((!type || type === 'agent') && limits.agent > 0) {
      searches.push(
        this.execute(this.createRequest('agents', trimmedQuery, limits.agent, {}, offset)),
      );
    }
    if ((!type || type === 'chatGroup') && limits.chatGroup > 0) {
      searches.push(
        this.execute(this.createRequest('chatGroups', trimmedQuery, limits.chatGroup, {}, offset)),
      );
    }
    if ((!type || type === 'topic') && limits.topic > 0) {
      searches.push(
        this.execute(this.createRequest('topics', trimmedQuery, limits.topic, { agentId }, offset)),
      );
    }
    if ((!type || type === 'message') && limits.message > 0) {
      searches.push(
        this.execute(
          this.createRequest('messages', trimmedQuery, limits.message, { agentId }, offset),
        ),
      );
    }
    if ((!type || type === 'file') && limits.file > 0) {
      searches.push(
        this.execute(
          this.createRequest(
            'files',
            trimmedQuery,
            limits.file,
            { excludeKnowledgeBaseIds },
            offset,
          ),
        ),
      );
    }
    if ((!type || type === 'folder') && limits.folder > 0) {
      searches.push(
        this.execute(
          this.createRequest(
            'documents',
            trimmedQuery,
            limits.folder,
            { documentKind: 'folder', excludeKnowledgeBaseIds },
            offset,
          ),
        ),
      );
    }
    if ((!type || type === 'page') && limits.page > 0) {
      searches.push(
        this.execute(
          this.createRequest(
            'documents',
            trimmedQuery,
            limits.page,
            { documentKind: 'page', excludeKnowledgeBaseIds },
            offset,
          ),
        ),
      );
    }
    if ((!type || type === 'memory') && limits.memory > 0) {
      searches.push(
        this.execute(this.createRequest('userMemories', trimmedQuery, limits.memory, {}, offset)),
      );
    }
    if ((!type || type === 'knowledgeBase') && limits.knowledgeBase > 0) {
      searches.push(
        this.execute(
          this.createRequest(
            'knowledgeBases',
            trimmedQuery,
            limits.knowledgeBase,
            { excludeKnowledgeBaseIds },
            offset,
          ),
        ),
      );
    }

    const responses = await Promise.all(searches);

    /** Each backend item already carries the existing hydrated response schema and display order. */
    return responses.flatMap((response) => response.items as DatabaseSearchResult[]);
  }

  async searchKnowledgeBaseDocuments(
    query: string,
    knowledgeBaseIds: string[],
    limit: number = 20,
  ): Promise<KnowledgeBaseDocumentHit[]> {
    if (!query || query.trim() === '') return [];
    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return [];

    const response = await this.execute(
      this.createRequest('documents', query.trim(), limit, {
        documentKind: 'knowledgeBaseDocument',
        knowledgeBaseIds,
      }),
    );

    return response.items as KnowledgeBaseDocumentHit[];
  }

  private calculateLimits(
    baseLimit: number,
    type?: SearchResultType,
    agentId?: string,
    contextType?: 'agent' | 'resource' | 'page',
  ): SearchLimits {
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
}

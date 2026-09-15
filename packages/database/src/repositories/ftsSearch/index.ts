import type { LobeChatDatabase } from '../../type';
import { PgSearchFtsSearchBackend } from './pgSearch';
import type {
  FtsSearchBackendFilters,
  FtsSearchBackendMeasurement,
  FtsSearchBackendRequest,
  FtsSearchBackendResponse,
  FtsSearchBackendScope,
  FtsSearchCandidateRequest,
  FtsSearchCandidateResult,
  FtsSearchDatabaseResult,
  FtsSearchKnowledgeBaseDocumentHit,
  FtsSearchOptions,
  FtsSearchRepoOptions,
  FtsSearchResult,
  FtsSearchResultType,
} from './types';

export * from './elasticsearch';
export { PgSearchFtsSearchBackend } from './pgSearch';
export * from './types';

interface FtsSearchLimits {
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

/** Identifies candidate-provider failures that must stay visible to API callers. */
export class FtsSearchCandidateError extends Error {
  constructor(cause: unknown) {
    super('Candidate search provider failed', { cause });
    this.name = 'FtsSearchCandidateError';
  }
}

/**
 * Provider-neutral search facade. Backends own candidate retrieval and final
 * PostgreSQL hydration, while this class preserves the public repository API.
 */
export class FtsSearchRepo {
  readonly ftsSearchCandidateEnabled: boolean;

  private backend: NonNullable<FtsSearchRepoOptions['backend']>;
  private onMeasurement?: FtsSearchRepoOptions['onMeasurement'];
  private scope: FtsSearchBackendScope;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    callerAgentVisibility?: 'private' | 'public' | null,
    options: FtsSearchRepoOptions = {},
  ) {
    this.scope = { callerAgentVisibility, userId, workspaceId };
    this.backend = options.backend ?? new PgSearchFtsSearchBackend(db, this.scope);
    this.ftsSearchCandidateEnabled = options.ftsSearchCandidateEnabled ?? false;
    this.onMeasurement = options.onMeasurement;
  }

  private createRequest(
    entity: FtsSearchBackendRequest['entity'],
    query: string,
    limit: number,
    filters: FtsSearchBackendFilters = {},
  ): FtsSearchBackendRequest {
    return {
      entity,
      filters,
      pagination: { limit },
      query: { text: query },
      scope: this.scope,
    };
  }

  private createMeasurementRequest(
    request: FtsSearchBackendRequest,
  ): FtsSearchBackendMeasurement['request'] {
    return {
      entity: request.entity,
      filterKeys: Object.entries(request.filters)
        .filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length > 0))
        .map(([key]) => key)
        .sort() as (keyof FtsSearchBackendFilters)[],
      limit: request.pagination.limit ?? 0,
      queryLength: request.query.text.length,
      scope: request.scope.workspaceId ? 'workspace' : 'personal',
    };
  }

  private async execute(request: FtsSearchBackendRequest): Promise<FtsSearchBackendResponse> {
    const startedAt = Date.now();

    try {
      const response = await this.backend.search(request);
      this.recordMeasurement({
        candidateCount: response.candidates.length,
        durationMs: Date.now() - startedAt,
        itemCount: response.items.length,
        provider: this.backend.key,
        request: this.createMeasurementRequest(request),
        status: 'success',
      });
      return response;
    } catch (error) {
      this.recordMeasurement({
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : typeof error,
        provider: this.backend.key,
        request: this.createMeasurementRequest(request),
        status: 'error',
      });
      throw error;
    }
  }

  /** Measurement failures must never change the selected provider's result or error. */
  private recordMeasurement(measurement: FtsSearchBackendMeasurement) {
    try {
      const hookResult = this.onMeasurement?.(measurement);
      if (hookResult) {
        void hookResult.catch((error) => {
          console.error('[FtsSearchRepo] measurement hook failed', error);
        });
      }
    } catch (error) {
      console.error('[FtsSearchRepo] measurement hook failed', error);
    }
  }

  /** Full-text search across the database-backed product result types. */
  async search(options: FtsSearchOptions): Promise<FtsSearchResult[]> {
    const { query, type, limitPerType = 5, agentId, contextType } = options;
    if (!query || query.trim() === '') return [];

    const trimmedQuery = query.trim();
    const limits = this.calculateLimits(limitPerType, type, agentId, contextType);
    const excludeKnowledgeBaseIds = options.excludeKnowledgeBaseIds ?? [];
    const searches: Promise<FtsSearchBackendResponse>[] = [];

    if ((!type || type === 'agent') && limits.agent > 0) {
      searches.push(this.execute(this.createRequest('agents', trimmedQuery, limits.agent)));
    }
    if ((!type || type === 'chatGroup') && limits.chatGroup > 0) {
      searches.push(this.execute(this.createRequest('chatGroups', trimmedQuery, limits.chatGroup)));
    }
    if ((!type || type === 'topic') && limits.topic > 0) {
      searches.push(
        this.execute(this.createRequest('topics', trimmedQuery, limits.topic, { agentId })),
      );
    }
    if ((!type || type === 'message') && limits.message > 0) {
      searches.push(
        this.execute(this.createRequest('messages', trimmedQuery, limits.message, { agentId })),
      );
    }
    if ((!type || type === 'file') && limits.file > 0) {
      searches.push(
        this.execute(
          this.createRequest('files', trimmedQuery, limits.file, { excludeKnowledgeBaseIds }),
        ),
      );
    }
    if ((!type || type === 'folder') && limits.folder > 0) {
      searches.push(
        this.execute(
          this.createRequest('documents', trimmedQuery, limits.folder, {
            documentKind: 'folder',
            excludeKnowledgeBaseIds,
          }),
        ),
      );
    }
    if ((!type || type === 'page') && limits.page > 0) {
      searches.push(
        this.execute(
          this.createRequest('documents', trimmedQuery, limits.page, {
            documentKind: 'page',
            excludeKnowledgeBaseIds,
          }),
        ),
      );
    }
    if ((!type || type === 'memory') && limits.memory > 0) {
      searches.push(this.execute(this.createRequest('userMemories', trimmedQuery, limits.memory)));
    }
    if ((!type || type === 'knowledgeBase') && limits.knowledgeBase > 0) {
      searches.push(
        this.execute(
          this.createRequest('knowledgeBases', trimmedQuery, limits.knowledgeBase, {
            excludeKnowledgeBaseIds,
          }),
        ),
      );
    }

    const responses = await Promise.all(searches);

    /** Each backend item already carries the existing hydrated response schema and display order. */
    return responses.flatMap((response) => response.items as FtsSearchDatabaseResult[]);
  }

  /** Candidate-only retrieval for legacy and hybrid paths that own their PostgreSQL hydration. */
  async ftsSearchCandidates(request: FtsSearchCandidateRequest): Promise<FtsSearchCandidateResult> {
    if (!this.ftsSearchCandidateEnabled) {
      throw new Error('Candidate-only search is not enabled for this repository');
    }

    const query = request.query.text.trim();
    if (!query) return { candidates: [], total: 0 };

    let response: FtsSearchBackendResponse;
    try {
      response = await this.execute({
        ...request,
        mode: 'candidates',
        query: { ...request.query, text: query },
        scope: this.scope,
      });
    } catch (error) {
      throw new FtsSearchCandidateError(error);
    }

    return {
      candidates: response.candidates,
      total: response.total ?? response.candidates.length,
    };
  }

  async searchKnowledgeBaseDocuments(
    query: string,
    knowledgeBaseIds: string[],
    limit: number = 20,
  ): Promise<FtsSearchKnowledgeBaseDocumentHit[]> {
    if (!query || query.trim() === '') return [];
    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return [];

    const response = await this.execute(
      this.createRequest('documents', query.trim(), limit, {
        documentKind: 'knowledgeBaseDocument',
        knowledgeBaseIds,
      }),
    );

    return response.items as FtsSearchKnowledgeBaseDocumentHit[];
  }

  private calculateLimits(
    baseLimit: number,
    type?: FtsSearchResultType,
    agentId?: string,
    contextType?: 'agent' | 'resource' | 'page',
  ): FtsSearchLimits {
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

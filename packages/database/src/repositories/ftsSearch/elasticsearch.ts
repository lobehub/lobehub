import type { LobeChatDatabase } from '../../type';
import { searchElasticsearchCandidates } from './elasticsearch/candidates';
import {
  hydrateAgents,
  hydrateChatGroups,
  hydrateFiles,
  hydrateFolders,
  hydrateKnowledgeBaseDocuments,
  hydrateKnowledgeBases,
  hydrateMessages,
  hydratePages,
  hydrateTopics,
  hydrateUserMemories,
} from './elasticsearch/hydration';
import type { ElasticsearchFtsSearchEntity } from './elasticsearch/query-fields';
import {
  isElasticsearchFtsSearchEntity,
  isElasticsearchFtsSearchMemoryEntity,
} from './elasticsearch/query-fields';
import type {
  ElasticsearchFtsSearchBackendOptions,
  ElasticsearchFtsSearchCandidateTarget,
  ElasticsearchFtsSearchClient,
  ElasticsearchFtsSearchObserver,
  ElasticsearchFtsSearchOperation,
  ElasticsearchFtsSearchResult,
  FtsSearchCandidateHit,
} from './elasticsearch/types';
import type {
  FtsSearchBackend,
  FtsSearchBackendRequest,
  FtsSearchBackendResponse,
  FtsSearchMessageResult,
  FtsSearchTopicResult,
} from './types';

export type {
  ElasticsearchFtsSearchConversationEntity,
  ElasticsearchFtsSearchEntity,
  ElasticsearchFtsSearchMemoryEntity,
  ElasticsearchFtsSearchResourceEntity,
} from './elasticsearch/query-fields';
export {
  ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS,
  isElasticsearchFtsSearchConversationEntity,
  isElasticsearchFtsSearchEntity,
  isElasticsearchFtsSearchMemoryEntity,
  isElasticsearchFtsSearchResourceEntity,
} from './elasticsearch/query-fields';
export type {
  ElasticsearchFtsSearchBackendOptions,
  ElasticsearchFtsSearchClient,
  ElasticsearchFtsSearchInput,
  ElasticsearchFtsSearchObserver,
  ElasticsearchFtsSearchOperation,
  ElasticsearchFtsSearchResponse,
} from './elasticsearch/types';

/** Prevent parent authorization misses from turning one product search into an unbounded scan. */
const MAX_PRODUCT_CANDIDATE_PAGES = 5;

const normalizeQuery = (query: string) =>
  query.trim().replaceAll('-', ' ').split(/\s+/).filter(Boolean).join(' ');

/** Elasticsearch candidate provider. Product hits are always reloaded through current PostgreSQL scope. */
export class ElasticsearchFtsSearchBackend implements FtsSearchBackend {
  readonly key = 'elasticsearch';

  private readonly client: ElasticsearchFtsSearchClient;
  private readonly indexNamespace: string;
  private readonly observer?: ElasticsearchFtsSearchObserver;

  constructor(
    private readonly db: LobeChatDatabase,
    { client, indexNamespace, observer }: ElasticsearchFtsSearchBackendOptions,
  ) {
    const namespace = indexNamespace.trim();
    if (!namespace) throw new Error('Elasticsearch search index namespace is required');

    this.client = client;
    this.indexNamespace = namespace;
    this.observer = observer;
  }

  private observe<Result>(
    entity: ElasticsearchFtsSearchEntity,
    operation: ElasticsearchFtsSearchOperation,
    callback: () => Promise<Result>,
  ): Promise<Result> {
    return this.observer?.observe(entity, operation, callback) ?? callback();
  }

  async search(
    request: FtsSearchBackendRequest,
  ): Promise<FtsSearchBackendResponse<ElasticsearchFtsSearchResult>> {
    const entity = request.entity;
    if (!isElasticsearchFtsSearchEntity(entity)) {
      throw new Error(`Unsupported Elasticsearch search entity: ${request.entity}`);
    }

    const query = normalizeQuery(request.query.text);
    if (!query) return { candidates: [], items: [], total: 0 };
    let target: ElasticsearchFtsSearchCandidateTarget;
    if (entity === 'documents') {
      const documentKind = request.filters.documentKind;
      if (!documentKind) {
        throw new Error('Elasticsearch document search requires a supported document kind');
      }
      target = { documentKind, entity };
    } else {
      target = { entity };
    }
    if (
      target.entity === 'documents' &&
      target.documentKind === 'knowledgeBaseDocument' &&
      !request.filters.knowledgeBaseIds?.length
    ) {
      return { candidates: [], items: [] };
    }

    if (
      target.entity === 'messages' &&
      request.mode !== 'candidates' &&
      request.filters.topicScope
    ) {
      /** Only the candidate-only TopicModel flow rejoins parent topics before returning results. */
      throw new Error(
        'Elasticsearch message topic scope requires candidate-only search and PostgreSQL parent filtering',
      );
    }

    if (
      request.mode !== 'candidates' &&
      (target.entity === 'topics' || target.entity === 'messages')
    ) {
      return this.searchConversationProduct(request, target.entity, query);
    }

    const candidateResult = await this.observe(entity, 'candidate_query', () =>
      searchElasticsearchCandidates(
        { client: this.client, indexNamespace: this.indexNamespace },
        request,
        target,
        query,
      ),
    );
    const { hits } = candidateResult;
    const candidates = hits.map(({ id, score }) => ({ id, score }));

    if (request.mode === 'candidates') {
      return { candidates, items: [], total: candidateResult.total };
    }

    const limit = request.pagination.limit;
    if (!limit) throw new Error('Elasticsearch product search requires a positive limit');

    if (entity === 'userMemories') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydrateUserMemories(this.db, hits, request.scope, limit),
        ),
        total: candidateResult.total,
      };
    }
    if (isElasticsearchFtsSearchMemoryEntity(entity)) {
      throw new Error(`Memory-layer entity only supports candidate search: ${entity}`);
    }

    if (request.entity === 'agents') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydrateAgents(this.db, hits, request.scope, limit),
        ),
      };
    }
    if (request.entity === 'chatGroups') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydrateChatGroups(this.db, hits, request.scope, limit),
        ),
      };
    }
    if (entity === 'files') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydrateFiles(
            this.db,
            hits,
            request.scope,
            limit,
            request.filters.excludeKnowledgeBaseIds,
          ),
        ),
      };
    }
    if (entity === 'knowledgeBases') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydrateKnowledgeBases(
            this.db,
            hits,
            request.scope,
            limit,
            request.filters.excludeKnowledgeBaseIds,
          ),
        ),
      };
    }
    if (target.entity !== 'documents') {
      throw new Error(`Unsupported Elasticsearch search entity: ${target.entity}`);
    }
    if (target.documentKind === 'folder') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydrateFolders(
            this.db,
            hits,
            request.scope,
            limit,
            request.filters.excludeKnowledgeBaseIds,
          ),
        ),
      };
    }
    if (target.documentKind === 'page') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydratePages(
            this.db,
            hits,
            request.scope,
            limit,
            request.filters.excludeKnowledgeBaseIds,
          ),
        ),
      };
    }
    if (target.documentKind === 'knowledgeBaseDocument') {
      return {
        candidates,
        items: await this.observe(entity, 'pg_hydration', () =>
          hydrateKnowledgeBaseDocuments(
            this.db,
            hits,
            request.scope,
            limit,
            request.filters.knowledgeBaseIds ?? [],
          ),
        ),
      };
    }

    target.documentKind satisfies never;
    throw new Error(`Unsupported Elasticsearch document kind: ${String(target.documentKind)}`);
  }

  /**
   * Conversation parent permissions are intentionally authoritative in PostgreSQL and cannot be
   * represented by the child search document. Continue after an authorization-heavy first page,
   * but stop after a 20x candidate budget: partial results are safer than unbounded user latency.
   */
  private async searchConversationProduct(
    request: FtsSearchBackendRequest,
    entity: 'messages' | 'topics',
    query: string,
  ): Promise<FtsSearchBackendResponse<ElasticsearchFtsSearchResult>> {
    const limit = request.pagination.limit;
    if (!limit) throw new Error('Elasticsearch product search requires a positive limit');

    const hits: FtsSearchCandidateHit[] = [];
    const seen = new Set<string>();
    const visibleItems = new Map<string, FtsSearchMessageResult | FtsSearchTopicResult>();
    let pageCount = 0;
    let searchAfter: unknown[] | undefined;

    while (pageCount < MAX_PRODUCT_CANDIDATE_PAGES) {
      const page = await this.observe(entity, 'candidate_query', () =>
        searchElasticsearchCandidates(
          { client: this.client, indexNamespace: this.indexNamespace },
          request,
          { entity },
          query,
          { searchAfter, singlePage: true },
        ),
      );
      pageCount += 1;
      const pageHits: FtsSearchCandidateHit[] = [];
      for (const hit of page.hits) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        const candidate = { ...hit, rank: hits.length };
        hits.push(candidate);
        pageHits.push(candidate);
      }

      const pageItems =
        entity === 'topics'
          ? await this.observe(entity, 'pg_hydration', () =>
              hydrateTopics(
                this.db,
                pageHits,
                request.scope,
                pageHits.length,
                request.filters.agentId,
              ),
            )
          : await this.observe(entity, 'pg_hydration', () =>
              hydrateMessages(
                this.db,
                pageHits,
                request.scope,
                pageHits.length,
                request.filters.agentId,
              ),
            );
      for (const item of pageItems) visibleItems.set(item.id, item);
      if (
        visibleItems.size >= limit ||
        page.exhausted ||
        pageCount >= MAX_PRODUCT_CANDIDATE_PAGES
      ) {
        break;
      }
      if (!page.nextFtsSearchAfter) {
        throw new Error('Elasticsearch bounded candidate search requires hit sort values');
      }
      searchAfter = page.nextFtsSearchAfter;
    }

    const hitById = new Map(hits.map((hit) => [hit.id, hit]));
    const maxScore = Math.max(0, ...[...visibleItems].map(([id]) => hitById.get(id)?.score ?? 0));
    const items = [...visibleItems.values()]
      .map((item) => {
        const score = hitById.get(item.id)?.score ?? 0;
        return { ...item, relevance: maxScore > 0 ? 1 + 2 * (1 - score / maxScore) : 3 };
      })
      .sort((left, right) =>
        entity === 'topics'
          ? right.updatedAt.getTime() - left.updatedAt.getTime()
          : right.createdAt.getTime() - left.createdAt.getTime(),
      )
      .slice(0, limit);

    return {
      candidates: hits.map(({ id, score }) => ({ id, score })),
      items,
    };
  }
}

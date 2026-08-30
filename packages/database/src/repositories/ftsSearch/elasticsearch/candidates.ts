import { LIBRARY_HIDDEN_FILE_SOURCES } from '@lobechat/types';

import { DOCUMENT_FOLDER_TYPE } from '../../../schemas';
import { getFtsSearchIndexAlias } from '../../ftsSearchDocument';
import type {
  FtsSearchBackendFilters,
  FtsSearchBackendRequest,
  FtsSearchBackendScope,
} from '../types';
import {
  ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_DOCUMENT_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS,
  type ElasticsearchFtsSearchEntity,
  isElasticsearchFtsSearchConversationEntity,
  isElasticsearchFtsSearchMemoryEntity,
} from './query-fields';
import type {
  ElasticsearchFtsSearchCandidateContext,
  ElasticsearchFtsSearchCandidateOptions,
  ElasticsearchFtsSearchCandidateResult,
  ElasticsearchFtsSearchCandidateTarget,
  FtsSearchCandidateHit,
} from './types';

/**
 * Candidate over-fetch keeps authorized lower-ranked hits available when an index still contains
 * a deleted or newly restricted document. PostgreSQL remains the final authorization source.
 */
const CANDIDATE_MULTIPLIER = 4;

const UNBOUNDED_CANDIDATE_PAGE_SIZE = 1000;

/**
 * Rolling reindexes leave legacy documents without newly denormalized fields. Keep those documents
 * eligible as candidates because PostgreSQL reapplies the exact filters during hydration.
 */
const exactOrLegacyMissingFilter = (
  field: string,
  exactClause: Record<string, unknown>,
): Record<string, unknown> => ({
  bool: {
    minimum_should_match: 1,
    should: [exactClause, { bool: { must_not: [{ exists: { field } }] } }],
  },
});

const buildScopeClauses = (
  entity: ElasticsearchFtsSearchEntity,
  scope: FtsSearchBackendScope,
): { filter: Array<Record<string, unknown>>; mustNot: Array<Record<string, unknown>> } => {
  if (isElasticsearchFtsSearchMemoryEntity(entity)) {
    return { filter: [{ term: { user_id: scope.userId } }], mustNot: [] };
  }

  if (!scope.workspaceId) {
    return {
      filter: [{ term: { user_id: scope.userId } }],
      mustNot: [{ exists: { field: 'workspace_id' } }],
    };
  }

  const filter: Array<Record<string, unknown>> = [{ term: { workspace_id: scope.workspaceId } }];
  if (
    entity === 'agents' ||
    entity === 'chatGroups' ||
    entity === 'documents' ||
    entity === 'files' ||
    entity === 'knowledgeBases'
  ) {
    filter.push(
      scope.callerAgentVisibility === 'public'
        ? {
            bool: {
              minimum_should_match: 1,
              should: [
                { bool: { must_not: [{ exists: { field: 'visibility' } }] } },
                { term: { visibility: 'public' } },
              ],
            },
          }
        : {
            bool: {
              minimum_should_match: 1,
              should: [
                { bool: { must_not: [{ exists: { field: 'visibility' } }] } },
                { term: { visibility: 'public' } },
                { term: { user_id: scope.userId } },
              ],
            },
          },
    );
  }

  return { filter, mustNot: [] };
};

const appendMemoryFilters = (
  entity: ElasticsearchFtsSearchEntity,
  filters: FtsSearchBackendFilters,
  clauses: Array<Record<string, unknown>>,
) => {
  if (!isElasticsearchFtsSearchMemoryEntity(entity)) return;

  if (filters.memoryCategories?.length) {
    const field = entity === 'userMemories' ? 'memory_category' : 'parent_memory_categories';
    const exactClause = { terms: { [field]: filters.memoryCategories } };
    clauses.push(
      entity === 'userMemories' ? exactClause : exactOrLegacyMissingFilter(field, exactClause),
    );
  }
  if (filters.memoryTypes?.length) {
    clauses.push({ terms: { type: filters.memoryTypes } });
  }
  if (filters.memoryRelationships?.length) {
    clauses.push({ terms: { relationship: filters.memoryRelationships } });
  }
  if (filters.memoryStatus?.length) {
    const field = entity === 'memoryContexts' ? 'current_status.raw' : 'status';
    /**
     * Do not treat a missing exact-value subfield as a legacy document. Elasticsearch also omits
     * keyword values above `ignore_above`, and accepting those would bypass the status filter.
     */
    clauses.push({ terms: { [field]: filters.memoryStatus } });
  }
  const tagClauses = (filters.memoryTags ?? []).map((tag) =>
    entity === 'userMemories'
      ? { term: { tags: tag } }
      : {
          bool: {
            minimum_should_match: 1,
            should: [
              { term: { tags: tag } },
              { term: { parent_tags: tag } },
              { bool: { must_not: [{ exists: { field: 'parent_tags' } }] } },
            ],
          },
        },
  );
  if (tagClauses.length > 0) {
    if (filters.memoryTagMatch === 'any') {
      clauses.push({ bool: { minimum_should_match: 1, should: tagClauses } });
    } else {
      clauses.push(...tagClauses);
    }
  }
  if (filters.memoryTimeRange) {
    const { end, field = 'capturedAt', start } = filters.memoryTimeRange;
    const dateRange = {
      ...(start ? { gte: start.toISOString() } : {}),
      ...(end ? { lte: end.toISOString() } : {}),
    };
    if (Object.keys(dateRange).length > 0) {
      const dateField = field.replaceAll(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
      clauses.push({ range: { [dateField]: dateRange } });
    }
  }
};

/**
 * Topics own their scope fields. Messages may carry the same fields for candidate pruning, but
 * topic-bound messages are also valid with only topic_id, so missing fields must survive until
 * PostgreSQL applies the authoritative parent-topic scope.
 */
const appendTopicScopeFilters = (
  entity: ElasticsearchFtsSearchEntity,
  filters: FtsSearchBackendFilters,
  clauses: Array<Record<string, unknown>>,
) => {
  if (entity !== 'topics' && entity !== 'messages') return;

  const scope = filters.topicScope;
  if (!scope) return;
  if (scope.groupId) {
    const exactClause = { term: { group_id: scope.groupId } };
    clauses.push(
      entity === 'messages' ? exactOrLegacyMissingFilter('group_id', exactClause) : exactClause,
    );
  } else if (scope.agentId) {
    const exactClause = { term: { agent_id: scope.agentId } };
    clauses.push(
      entity === 'messages' ? exactOrLegacyMissingFilter('agent_id', exactClause) : exactClause,
    );
  } else if (scope.containerId) {
    const exactClauses = [
      { term: { session_id: scope.containerId } },
      { term: { group_id: scope.containerId } },
    ];
    clauses.push({
      bool: {
        minimum_should_match: 1,
        should:
          entity === 'messages'
            ? [
                ...exactClauses,
                {
                  bool: {
                    must_not: [
                      { exists: { field: 'session_id' } },
                      { exists: { field: 'group_id' } },
                    ],
                  },
                },
              ]
            : exactClauses,
      },
    });
  }
};

export const searchElasticsearchCandidates = async (
  { client, indexNamespace }: ElasticsearchFtsSearchCandidateContext,
  request: FtsSearchBackendRequest,
  target: ElasticsearchFtsSearchCandidateTarget,
  query: string,
  options: ElasticsearchFtsSearchCandidateOptions = {},
): Promise<ElasticsearchFtsSearchCandidateResult> => {
  const { entity } = target;
  const { filter, mustNot } = buildScopeClauses(entity, request.scope);
  mustNot.push({ term: { fts_search_sync_deleted: true } });
  if (request.filters.agentId && (entity === 'topics' || entity === 'messages')) {
    filter.push({ term: { agent_id: request.filters.agentId } });
  }
  if (entity === 'messages' && request.mode !== 'candidates') {
    mustNot.push({ term: { role: 'tool' } });
  }
  if (request.filters.excludeVirtual && entity === 'agents') {
    mustNot.push({ term: { virtual: true } });
  }
  if (entity === 'files') {
    mustNot.push(
      { term: { file_type: 'custom/document' } },
      { terms: { source: LIBRARY_HIDDEN_FILE_SOURCES } },
    );
    if (request.filters.excludeKnowledgeBaseIds?.length) {
      mustNot.push({ terms: { knowledge_base_ids: request.filters.excludeKnowledgeBaseIds } });
    }
  }
  if (entity === 'knowledgeBases' && request.filters.excludeKnowledgeBaseIds?.length) {
    mustNot.push({ terms: { id: request.filters.excludeKnowledgeBaseIds } });
  }
  if (target.entity === 'documents') {
    const { documentKind } = target;
    if (documentKind === 'folder') {
      filter.push({ term: { file_type: DOCUMENT_FOLDER_TYPE } });
    } else if (documentKind === 'page') {
      filter.push({ term: { file_type: 'custom/document' } });
    } else if (documentKind === 'knowledgeBaseDocument') {
      filter.push({ terms: { knowledge_base_ids: request.filters.knowledgeBaseIds ?? [] } });
      mustNot.push({ term: { file_type: DOCUMENT_FOLDER_TYPE } });
    } else {
      documentKind satisfies never;
      throw new Error(`Unsupported Elasticsearch document kind: ${String(documentKind)}`);
    }
    if (
      documentKind !== 'knowledgeBaseDocument' &&
      request.filters.excludeKnowledgeBaseIds?.length
    ) {
      mustNot.push({ terms: { knowledge_base_ids: request.filters.excludeKnowledgeBaseIds } });
    }
  }

  appendMemoryFilters(entity, request.filters, filter);
  appendTopicScopeFilters(entity, request.filters, filter);

  const fields =
    request.query.fields ??
    (target.entity === 'documents'
      ? ELASTICSEARCH_FTS_SEARCH_DOCUMENT_QUERY_FIELDS[target.documentKind]
      : isElasticsearchFtsSearchConversationEntity(target.entity)
        ? ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS[target.entity]
        : isElasticsearchFtsSearchMemoryEntity(target.entity)
          ? ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS[target.entity]
          : ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS[target.entity]);
  const requestedLimit = request.pagination.limit;
  const size = requestedLimit
    ? requestedLimit * CANDIDATE_MULTIPLIER
    : UNBOUNDED_CANDIDATE_PAGE_SIZE;
  const trackTotalHits = request.mode === 'candidates';
  const seen = new Set<string>();
  const hits: FtsSearchCandidateHit[] = [];
  let exhausted = false;
  let nextFtsSearchAfter: unknown[] | undefined;
  let searchAfter = options.searchAfter;
  let shouldContinue = true;
  let total = 0;

  /** Unbounded legacy APIs require exhaustive hydration; search_after avoids the result window. */
  while (shouldContinue) {
    const isFirstPage = searchAfter === undefined;
    const response = await client.search({
      body: {
        _source: false,
        query: {
          bool: {
            filter,
            must: [
              {
                multi_match: {
                  fields,
                  operator: 'and',
                  query,
                  type: 'best_fields',
                },
              },
            ],
            must_not: mustNot,
          },
        },
        ...(searchAfter ? { search_after: searchAfter } : {}),
        size,
        sort: [{ _score: 'desc' }, { id: 'asc' }],
        ...(trackTotalHits && isFirstPage ? { track_total_hits: true } : {}),
      },
      entity,
      index: getFtsSearchIndexAlias(indexNamespace, entity),
      pagination: requestedLimit ? 'bounded' : 'unbounded',
    });
    if (isFirstPage) {
      const responseTotal = response.hits.total;
      total =
        typeof responseTotal === 'number'
          ? responseTotal
          : (responseTotal?.value ?? hits.length + response.hits.hits.length);
    }

    for (const hit of response.hits.hits) {
      if (!hit._id || seen.has(hit._id)) continue;
      seen.add(hit._id);
      hits.push({ id: hit._id, rank: hits.length, score: hit._score });
    }

    exhausted = response.hits.hits.length < size;
    nextFtsSearchAfter = exhausted ? undefined : response.hits.hits.at(-1)?.sort;
    if (options.singlePage || requestedLimit || exhausted) {
      shouldContinue = false;
    } else {
      if (!nextFtsSearchAfter) {
        throw new Error('Elasticsearch unbounded candidate search requires hit sort values');
      }
      searchAfter = nextFtsSearchAfter;
    }
  }

  return { exhausted, hits, nextFtsSearchAfter, total: Math.max(total, hits.length) };
};

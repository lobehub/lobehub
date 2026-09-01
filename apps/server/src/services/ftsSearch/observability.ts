import type { Attributes, Span } from '@lobechat/observability-otel/api';
import { diag, metrics, SpanStatusCode, trace } from '@lobechat/observability-otel/api';

import type {
  ElasticsearchFtsSearchEntity,
  ElasticsearchFtsSearchObserver,
  FtsSearchBackend,
  FtsSearchBackendEntity,
  FtsSearchBackendRequest,
  FtsSearchBackendResponse,
} from '@/database/repositories/ftsSearch';

import type { FtsSearchProvider } from '.';

export type FtsSearchBackendOperation = 'candidate_query' | 'pg_hydration' | 'product_path';
export type FtsSearchBackendOperationResult = 'error' | 'success';
export type ElasticsearchFtsSearchRequestResult =
  'http_error' | 'other_error' | 'parse_error' | 'success' | 'timeout';
export type ElasticsearchFtsSearchErrorCode =
  | 'authentication'
  | 'authorization'
  | 'index_not_found'
  | 'invalid_query'
  | 'none'
  | 'rate_limited'
  | 'request_too_large'
  | 'response_parse_error'
  | 'server_error'
  | 'timeout'
  | 'too_many_clauses'
  | 'transport_error'
  | 'unknown_http_error';
export type ElasticsearchFtsSearchTraceContext = 'missing' | 'non_recording' | 'recording';
export type UserMemoryLexicalSearchDecision = 'executed' | 'skipped_long_context';
export type UserMemoryLexicalSearchSource =
  'api' | 'memory_extraction' | 'tool' | 'topic_retrieval';

export interface FtsSearchBackendOperationAttributes {
  entity: FtsSearchBackendEntity;
  operation: FtsSearchBackendOperation;
  provider: FtsSearchProvider;
  result: FtsSearchBackendOperationResult;
}

type FtsSearchBackendOperationBaseAttributes = Omit<FtsSearchBackendOperationAttributes, 'result'>;

const meter = metrics.getMeter('fts-search-backend');
const tracer = trace.getTracer('fts.search.backend');

const operationCounter = meter.createCounter('fts_search_backend_operations_total', {
  description:
    'Full-text search backend operations grouped by provider, entity, operation, and result.',
  unit: '{operation}',
});

const operationDuration = meter.createHistogram('fts_search_backend_operation_duration', {
  description:
    'Full-text search backend operation duration by provider, entity, operation, and result.',
  unit: 'ms',
});

const resultCount = meter.createHistogram('fts_search_backend_result_count', {
  description: 'Requested, candidate, and hydrated product result counts for successful searches.',
});

const elasticsearchRequests = meter.createCounter('fts_search_elasticsearch_requests_total', {
  description: 'Actual Elasticsearch search requests grouped by entity and result.',
  unit: '{request}',
});

const elasticsearchRequestDuration = meter.createHistogram(
  'fts_search_elasticsearch_request_duration',
  {
    description: 'End-to-end Elasticsearch search request duration including response parsing.',
    unit: 'ms',
  },
);

const elasticsearchRequestBytes = meter.createHistogram('fts_search_elasticsearch_request_size', {
  description: 'Serialized Elasticsearch search request body size.',
  unit: 'By',
});

const elasticsearchOriginalQueryCharacters = meter.createHistogram(
  'fts_search_elasticsearch_original_query_characters',
  {
    description: 'Unicode code points in the original Elasticsearch lexical query.',
    unit: '{character}',
  },
);

const elasticsearchExecutedQueryCharacters = meter.createHistogram(
  'fts_search_elasticsearch_executed_query_characters',
  {
    description: 'Unicode code points sent in the bounded Elasticsearch lexical query.',
    unit: '{character}',
  },
);

const elasticsearchServerTook = meter.createHistogram('fts_search_elasticsearch_server_took', {
  description: 'Elasticsearch-reported server processing time for successful search requests.',
  unit: 'ms',
});

const elasticsearchResponseContentLength = meter.createHistogram(
  'fts_search_elasticsearch_response_content_length',
  {
    description: 'Elasticsearch search response Content-Length when provided.',
    unit: 'By',
  },
);

const elasticsearchResponseDecodedBytes = meter.createHistogram(
  'fts_search_elasticsearch_response_decoded_size',
  {
    description: 'Decoded Elasticsearch search response body size.',
    unit: 'By',
  },
);

const elasticsearchResponseHits = meter.createHistogram('fts_search_elasticsearch_response_hits', {
  description: 'Hits returned by each Elasticsearch search request.',
});

const userMemoryLexicalDecisions = meter.createCounter(
  'fts_search_user_memory_lexical_decisions_total',
  {
    description: 'User-memory lexical search decisions grouped by bounded source and decision.',
    unit: '{decision}',
  },
);

const userMemoryLexicalQueryCharacters = meter.createHistogram(
  'fts_search_user_memory_lexical_query_characters',
  {
    description: 'Unicode code points considered for user-memory lexical retrieval.',
    unit: '{character}',
  },
);

const recordSafely = (operation: string, record: () => void): void => {
  try {
    record();
  } catch (error) {
    /** Telemetry failures must never change the selected search provider's behavior. */
    diag.error(`[fts-search-backend] failed to record ${operation}`, error);
  }
};

/** Metric labels are deliberately limited to bounded rollout dimensions. */
export const buildFtsSearchBackendMetricAttributes = (
  attributes: FtsSearchBackendOperationAttributes,
): Attributes => ({
  entity: attributes.entity,
  operation: attributes.operation,
  provider: attributes.provider,
  result: attributes.result,
});

const finishOperation = (
  span: Span,
  startedAt: number,
  attributes: FtsSearchBackendOperationBaseAttributes,
  result: FtsSearchBackendOperationResult,
) => {
  const metricAttributes = buildFtsSearchBackendMetricAttributes({ ...attributes, result });
  recordSafely('operation metrics', () => {
    operationCounter.add(1, metricAttributes);
    operationDuration.record(Date.now() - startedAt, metricAttributes);
    span.setAttribute('fts.search.backend.result', result);
    span.setStatus({ code: result === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
  });
  try {
    span.end();
  } catch (error) {
    diag.error('[fts-search-backend] failed to end telemetry span', error);
  }
};

export const recordElasticsearchFtsSearchRequest = (input: {
  contentLength?: number;
  decodedBytes?: number;
  durationMs: number;
  entity: ElasticsearchFtsSearchEntity;
  errorCode: ElasticsearchFtsSearchErrorCode;
  executedQueryChars: number;
  hits?: number;
  originalQueryChars: number;
  pagination: 'bounded' | 'unbounded';
  queryFieldCount: number;
  requestBytes: number;
  result: ElasticsearchFtsSearchRequestResult;
  serverTookMs?: number;
  traceContext: ElasticsearchFtsSearchTraceContext;
  truncated: boolean;
}): void => {
  recordSafely('Elasticsearch search request', () => {
    const histogramAttributes: Attributes = {
      entity: input.entity,
      pagination: input.pagination,
      result: input.result,
    };
    const requestAttributes: Attributes = {
      ...histogramAttributes,
      error_code: input.errorCode,
      query_truncated: input.truncated,
      trace_context: input.traceContext,
    };
    elasticsearchRequests.add(1, requestAttributes);
    elasticsearchRequestDuration.record(input.durationMs, histogramAttributes);
    elasticsearchRequestBytes.record(input.requestBytes, histogramAttributes);
    elasticsearchOriginalQueryCharacters.record(input.originalQueryChars, histogramAttributes);
    elasticsearchExecutedQueryCharacters.record(input.executedQueryChars, histogramAttributes);
    if (input.contentLength !== undefined) {
      elasticsearchResponseContentLength.record(input.contentLength, histogramAttributes);
    }
    if (input.decodedBytes !== undefined) {
      elasticsearchResponseDecodedBytes.record(input.decodedBytes, histogramAttributes);
    }
    if (input.hits !== undefined) {
      elasticsearchResponseHits.record(input.hits, histogramAttributes);
    }
    if (input.serverTookMs !== undefined) {
      elasticsearchServerTook.record(input.serverTookMs, histogramAttributes);
    }
  });
};

export const recordUserMemoryLexicalSearchDecision = (input: {
  decision: UserMemoryLexicalSearchDecision;
  queryCharacters: number;
  source: UserMemoryLexicalSearchSource;
}): void => {
  recordSafely('user-memory lexical search decision', () => {
    const attributes: Attributes = { decision: input.decision, source: input.source };
    userMemoryLexicalDecisions.add(1, attributes);
    userMemoryLexicalQueryCharacters.record(input.queryCharacters, attributes);
  });
};

const recordFtsSearchBackendResult = (
  provider: FtsSearchProvider,
  request: FtsSearchBackendRequest,
  response: FtsSearchBackendResponse,
): void => {
  recordSafely('search result counts', () => {
    const requestedLimit = request.pagination.limit;
    const hasValidRequestedLimit =
      typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) && requestedLimit > 0;
    const baseAttributes = {
      entity: request.entity,
      pagination: hasValidRequestedLimit ? 'bounded' : 'unbounded',
      provider,
    };
    if (hasValidRequestedLimit) {
      resultCount.record(requestedLimit, { ...baseAttributes, stage: 'requested' });
    }
    resultCount.record(response.candidates.length, {
      ...baseAttributes,
      stage: 'candidate',
    });
    resultCount.record(response.items.length, { ...baseAttributes, stage: 'product' });
  });
};

export const observeFtsSearchBackendOperation = async <Result>(
  attributes: FtsSearchBackendOperationBaseAttributes,
  operation: () => Promise<Result>,
): Promise<Result> =>
  tracer.startActiveSpan(
    `fts.search.backend.${attributes.operation}`,
    {
      attributes: {
        'fts.search.backend.entity': attributes.entity,
        'fts.search.backend.operation': attributes.operation,
        'fts.search.backend.provider': attributes.provider,
      },
    },
    async (span) => {
      const startedAt = Date.now();
      try {
        const result = await operation();
        finishOperation(span, startedAt, attributes, 'success');
        return result;
      } catch (error) {
        finishOperation(span, startedAt, attributes, 'error');
        throw error;
      }
    },
  );

export const createElasticsearchFtsSearchObserver = (): ElasticsearchFtsSearchObserver => ({
  observe: (entity, operation, callback) =>
    observeFtsSearchBackendOperation({ entity, operation, provider: 'elasticsearch' }, callback),
});

export const withFtsSearchBackendObservability = (
  backend: FtsSearchBackend,
  resolveProvider: (request: FtsSearchBackendRequest) => FtsSearchProvider,
): FtsSearchBackend => ({
  key: backend.key,
  search: (request) => {
    const provider = resolveProvider(request);
    return observeFtsSearchBackendOperation(
      {
        entity: request.entity,
        operation: 'product_path',
        provider,
      },
      async () => {
        const response = await backend.search(request);
        recordFtsSearchBackendResult(provider, request, response);
        return response;
      },
    );
  },
});

import type { Attributes, Span } from '@lobechat/observability-otel/api';
import { diag, metrics, SpanStatusCode, trace } from '@lobechat/observability-otel/api';

import type {
  ElasticsearchSearchEntity,
  ElasticsearchSearchObserver,
  SearchBackend,
  SearchBackendEntity,
  SearchBackendRequest,
  SearchBackendResponse,
} from '@/database/repositories/search';

import type { SearchBackendProvider } from '.';

export type SearchBackendOperation = 'candidate_query' | 'pg_hydration' | 'product_path';
export type SearchBackendOperationResult = 'error' | 'success';
export type ElasticsearchSearchRequestResult =
  'http_error' | 'other_error' | 'parse_error' | 'success' | 'timeout';

export interface SearchBackendOperationAttributes {
  entity: SearchBackendEntity;
  operation: SearchBackendOperation;
  provider: SearchBackendProvider;
  result: SearchBackendOperationResult;
}

type SearchBackendOperationBaseAttributes = Omit<SearchBackendOperationAttributes, 'result'>;

const meter = metrics.getMeter('search-backend');
const tracer = trace.getTracer('search-backend');

const operationCounter = meter.createCounter('search_backend_operations_total', {
  description: 'Search backend operations grouped by provider, entity, operation, and result.',
  unit: '{operation}',
});

const operationDuration = meter.createHistogram('search_backend_operation_duration', {
  description: 'Search backend operation duration by provider, entity, operation, and result.',
  unit: 'ms',
});

const resultCount = meter.createHistogram('search_backend_result_count', {
  description: 'Requested, candidate, and hydrated product result counts for successful searches.',
});

const elasticsearchRequests = meter.createCounter('search_elasticsearch_requests_total', {
  description: 'Actual Elasticsearch search requests grouped by entity and result.',
  unit: '{request}',
});

const elasticsearchRequestDuration = meter.createHistogram(
  'search_elasticsearch_request_duration',
  {
    description: 'End-to-end Elasticsearch search request duration including response parsing.',
    unit: 'ms',
  },
);

const elasticsearchRequestBytes = meter.createHistogram('search_elasticsearch_request_size', {
  description: 'Serialized Elasticsearch search request body size.',
  unit: 'By',
});

const elasticsearchServerTook = meter.createHistogram('search_elasticsearch_server_took', {
  description: 'Elasticsearch-reported server processing time for successful search requests.',
  unit: 'ms',
});

const elasticsearchResponseContentLength = meter.createHistogram(
  'search_elasticsearch_response_content_length',
  {
    description: 'Elasticsearch search response Content-Length when provided.',
    unit: 'By',
  },
);

const elasticsearchResponseDecodedBytes = meter.createHistogram(
  'search_elasticsearch_response_decoded_size',
  {
    description: 'Decoded Elasticsearch search response body size.',
    unit: 'By',
  },
);

const elasticsearchResponseHits = meter.createHistogram('search_elasticsearch_response_hits', {
  description: 'Hits returned by each Elasticsearch search request.',
});

const recordSafely = (operation: string, record: () => void): void => {
  try {
    record();
  } catch (error) {
    /** Telemetry failures must never change the selected search provider's behavior. */
    diag.error(`[search-backend] failed to record ${operation}`, error);
  }
};

/** Metric labels are deliberately limited to bounded rollout dimensions. */
export const buildSearchBackendMetricAttributes = (
  attributes: SearchBackendOperationAttributes,
): Attributes => ({
  entity: attributes.entity,
  operation: attributes.operation,
  provider: attributes.provider,
  result: attributes.result,
});

const finishOperation = (
  span: Span,
  startedAt: number,
  attributes: SearchBackendOperationBaseAttributes,
  result: SearchBackendOperationResult,
) => {
  const metricAttributes = buildSearchBackendMetricAttributes({ ...attributes, result });
  recordSafely('operation metrics', () => {
    operationCounter.add(1, metricAttributes);
    operationDuration.record(Date.now() - startedAt, metricAttributes);
    span.setAttribute('result', result);
    span.setStatus({ code: result === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
  });
  try {
    span.end();
  } catch (error) {
    diag.error('[search-backend] failed to end telemetry span', error);
  }
};

export const recordElasticsearchSearchRequest = (input: {
  contentLength?: number;
  decodedBytes?: number;
  durationMs: number;
  entity: ElasticsearchSearchEntity;
  hits?: number;
  pagination: 'bounded' | 'unbounded';
  requestBytes: number;
  result: ElasticsearchSearchRequestResult;
  serverTookMs?: number;
}): void => {
  recordSafely('Elasticsearch search request', () => {
    const attributes: Attributes = {
      entity: input.entity,
      pagination: input.pagination,
      result: input.result,
    };
    elasticsearchRequests.add(1, attributes);
    elasticsearchRequestDuration.record(input.durationMs, attributes);
    elasticsearchRequestBytes.record(input.requestBytes, attributes);
    if (input.contentLength !== undefined) {
      elasticsearchResponseContentLength.record(input.contentLength, attributes);
    }
    if (input.decodedBytes !== undefined) {
      elasticsearchResponseDecodedBytes.record(input.decodedBytes, attributes);
    }
    if (input.hits !== undefined) elasticsearchResponseHits.record(input.hits, attributes);
    if (input.serverTookMs !== undefined) {
      elasticsearchServerTook.record(input.serverTookMs, attributes);
    }
  });
};

const recordSearchBackendResult = (
  provider: SearchBackendProvider,
  request: SearchBackendRequest,
  response: SearchBackendResponse,
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

export const observeSearchBackendOperation = async <Result>(
  attributes: SearchBackendOperationBaseAttributes,
  operation: () => Promise<Result>,
): Promise<Result> =>
  tracer.startActiveSpan(
    `search.backend.${attributes.operation}`,
    {
      attributes: {
        entity: attributes.entity,
        operation: attributes.operation,
        provider: attributes.provider,
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

export const createElasticsearchSearchObserver = (): ElasticsearchSearchObserver => ({
  observe: (entity, operation, callback) =>
    observeSearchBackendOperation({ entity, operation, provider: 'elasticsearch' }, callback),
});

export const withSearchBackendObservability = (
  backend: SearchBackend,
  resolveProvider: (request: SearchBackendRequest) => SearchBackendProvider,
): SearchBackend => ({
  key: backend.key,
  search: (request) => {
    const provider = resolveProvider(request);
    return observeSearchBackendOperation(
      {
        entity: request.entity,
        operation: 'product_path',
        provider,
      },
      async () => {
        const response = await backend.search(request);
        recordSearchBackendResult(provider, request, response);
        return response;
      },
    );
  },
});

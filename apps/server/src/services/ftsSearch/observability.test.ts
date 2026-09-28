// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FtsSearchBackend } from '@/database/repositories/ftsSearch';

import {
  buildFtsSearchBackendMetricAttributes,
  recordElasticsearchFtsSearchRequest,
  recordUserMemoryLexicalSearchDecision,
  withFtsSearchBackendObservability,
} from './observability';

const mocks = vi.hoisted(() => {
  const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
  const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>();
  const span = {
    end: vi.fn(),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
  };
  const startActiveSpan = vi.fn(
    (_name: string, _options: unknown, callback: (span: unknown) => unknown) => callback(span),
  );
  return { counters, histograms, span, startActiveSpan };
});

vi.mock('@lobechat/observability-otel/api', () => ({
  diag: { error: vi.fn() },
  metrics: {
    getMeter: () => ({
      createCounter: (name: string) => {
        const counter = { add: vi.fn() };
        mocks.counters.set(name, counter);
        return counter;
      },
      createHistogram: (name: string) => {
        const histogram = { record: vi.fn() };
        mocks.histograms.set(name, histogram);
        return histogram;
      },
    }),
  },
  SpanStatusCode: { ERROR: 2, OK: 1 },
  trace: {
    getTracer: () => ({
      startActiveSpan: mocks.startActiveSpan,
    }),
  },
}));

describe('full-text search backend observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a bounded metric label set without request or scope identifiers', () => {
    expect(
      buildFtsSearchBackendMetricAttributes({
        entity: 'messages',
        operation: 'pg_hydration',
        provider: 'elasticsearch',
        result: 'success',
        usage: 'message_search',
      }),
    ).toEqual({
      entity: 'messages',
      operation: 'pg_hydration',
      provider: 'elasticsearch',
      result: 'success',
      usage: 'message_search',
    });
  });

  it('observes the PostgreSQL product path and preserves its response', async () => {
    const response = { candidates: [], items: [] };
    const backend: FtsSearchBackend = {
      key: 'pg_search',
      search: vi.fn().mockResolvedValue(response),
    };
    const resolveProvider = vi.fn(() => 'pg_search' as const);
    const observed = withFtsSearchBackendObservability(backend, resolveProvider, 'unified_search');
    const request = {
      entity: 'agents',
      filters: {},
      pagination: { limit: 5 },
      query: { text: 'private query' },
      scope: { userId: 'private-user', workspaceId: 'private-workspace' },
    } as const;

    await expect(observed.search(request)).resolves.toBe(response);
    expect(resolveProvider).toHaveBeenCalledWith(request);
    const resultCount = mocks.histograms.get('fts_search_backend_result_count')?.record;
    expect(resultCount).toHaveBeenCalledWith(5, {
      entity: 'agents',
      pagination: 'bounded',
      provider: 'pg_search',
      stage: 'requested',
    });
    expect(resultCount).toHaveBeenCalledWith(0, {
      entity: 'agents',
      pagination: 'bounded',
      provider: 'pg_search',
      stage: 'candidate',
    });
    expect(mocks.startActiveSpan).toHaveBeenCalledWith(
      'fts.search.backend.product_path',
      {
        attributes: {
          'fts.search.backend.entity': 'agents',
          'fts.search.backend.operation': 'product_path',
          'fts.search.backend.provider': 'pg_search',
          'fts.search.backend.usage': 'unified_search',
        },
      },
      expect.any(Function),
    );
    expect(mocks.span.setAttribute).toHaveBeenCalledWith('fts.search.backend.result', 'success');
  });

  it('does not record a requested result count for unbounded pagination', async () => {
    const response = { candidates: [], items: [] };
    const backend: FtsSearchBackend = {
      key: 'pg_search',
      search: vi.fn().mockResolvedValue(response),
    };
    const observed = withFtsSearchBackendObservability(backend, () => 'pg_search', 'unattributed');

    await expect(
      observed.search({
        entity: 'agents',
        filters: {},
        pagination: {},
        query: { text: 'private query' },
        scope: { userId: 'private-user' },
      }),
    ).resolves.toBe(response);

    const resultCount = mocks.histograms.get('fts_search_backend_result_count')?.record;
    expect(resultCount).toHaveBeenCalledTimes(2);
    expect(resultCount).toHaveBeenCalledWith(0, {
      entity: 'agents',
      pagination: 'unbounded',
      provider: 'pg_search',
      stage: 'candidate',
    });
    expect(resultCount).toHaveBeenCalledWith(0, {
      entity: 'agents',
      pagination: 'unbounded',
      provider: 'pg_search',
      stage: 'product',
    });
  });

  it('records actual Elasticsearch cost signals with only bounded dimensions', () => {
    recordElasticsearchFtsSearchRequest({
      contentLength: 1024,
      decodedBytes: 2048,
      durationMs: 40,
      entity: 'messages',
      errorCode: 'none',
      executedQueryChars: 32,
      hits: 20,
      originalQueryChars: 64,
      pagination: 'bounded',
      queryFieldCount: 2,
      requestBytes: 512,
      result: 'success',
      serverTookMs: 12,
      traceContext: 'recording',
      truncated: true,
      usage: 'unified_search',
    });

    const requestAttributes = {
      entity: 'messages',
      error_code: 'none',
      pagination: 'bounded',
      query_truncated: true,
      result: 'success',
      trace_context: 'recording',
      usage: 'unified_search',
    };
    const histogramAttributes = {
      entity: 'messages',
      pagination: 'bounded',
      result: 'success',
    };
    const costAttributes = { ...histogramAttributes, usage: 'unified_search' };
    expect(mocks.counters.get('fts_search_elasticsearch_requests_total')?.add).toHaveBeenCalledWith(
      1,
      requestAttributes,
    );
    expect(
      mocks.histograms.get('fts_search_elasticsearch_server_took')?.record,
    ).toHaveBeenCalledWith(12, costAttributes);
    expect(
      mocks.histograms.get('fts_search_elasticsearch_response_decoded_size')?.record,
    ).toHaveBeenCalledWith(2048, costAttributes);
    expect(
      mocks.histograms.get('fts_search_elasticsearch_response_content_length')?.record,
    ).toHaveBeenCalledWith(1024, costAttributes);
    expect(
      mocks.histograms.get('fts_search_elasticsearch_request_size')?.record,
    ).toHaveBeenCalledWith(512, costAttributes);
    expect(
      mocks.histograms.get('fts_search_elasticsearch_response_hits')?.record,
    ).toHaveBeenCalledWith(20, costAttributes);
    expect(
      mocks.histograms.get('fts_search_elasticsearch_original_query_characters')?.record,
    ).toHaveBeenCalledWith(64, costAttributes);
    expect(
      mocks.histograms.get('fts_search_elasticsearch_executed_query_characters')?.record,
    ).toHaveBeenCalledWith(32, costAttributes);
    expect(
      mocks.histograms.get('fts_search_elasticsearch_request_duration')?.record,
    ).toHaveBeenCalledWith(40, costAttributes);
    expect(Object.keys(requestAttributes)).toEqual([
      'entity',
      'error_code',
      'pagination',
      'query_truncated',
      'result',
      'trace_context',
      'usage',
    ]);
    expect(Object.keys(costAttributes)).toEqual(['entity', 'pagination', 'result', 'usage']);
  });

  it('records when long user-memory context skips conjunction-based lexical search', () => {
    recordUserMemoryLexicalSearchDecision({
      decision: 'skipped_long_context',
      queryCharacters: 7000,
      source: 'topic_retrieval',
    });

    const attributes = { decision: 'skipped_long_context', source: 'topic_retrieval' };
    expect(
      mocks.counters.get('fts_search_user_memory_lexical_decisions_total')?.add,
    ).toHaveBeenCalledWith(1, attributes);
    expect(
      mocks.histograms.get('fts_search_user_memory_lexical_query_characters')?.record,
    ).toHaveBeenCalledWith(7000, attributes);
  });

  it('preserves the selected provider error', async () => {
    const providerError = new Error('provider unavailable');
    const backend: FtsSearchBackend = {
      key: 'elasticsearch',
      search: vi.fn().mockRejectedValue(providerError),
    };
    const observed = withFtsSearchBackendObservability(
      backend,
      () => 'elasticsearch',
      'message_search',
    );

    await expect(
      observed.search({
        entity: 'messages',
        filters: {},
        pagination: { limit: 5 },
        query: { text: 'private query' },
        scope: { userId: 'private-user' },
      }),
    ).rejects.toBe(providerError);
    expect(mocks.span.recordException).not.toHaveBeenCalled();
  });

  it('does not change the provider result when telemetry finalization fails', async () => {
    const response = { candidates: [], items: [] };
    const backend: FtsSearchBackend = {
      key: 'pg_search',
      search: vi.fn().mockResolvedValue(response),
    };
    const observed = withFtsSearchBackendObservability(backend, () => 'pg_search', 'unattributed');
    mocks.span.end.mockImplementationOnce(() => {
      throw new Error('telemetry unavailable');
    });

    await expect(
      observed.search({
        entity: 'agents',
        filters: {},
        pagination: { limit: 5 },
        query: { text: 'private query' },
        scope: { userId: 'private-user' },
      }),
    ).resolves.toBe(response);
  });
});

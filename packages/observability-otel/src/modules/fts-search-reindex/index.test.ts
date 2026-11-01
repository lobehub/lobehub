import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  observeFtsSearchReindexRun,
  recordFtsSearchReindexBatch,
  recordFtsSearchReindexBulkRequest,
  recordFtsSearchReindexBulkRetry,
  recordFtsSearchReindexReconciliation,
} from '.';

const mocks = vi.hoisted(() => {
  const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
  const gauges = new Map<string, { record: ReturnType<typeof vi.fn> }>();
  const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>();
  const getMeter = vi.fn(() => ({
    createCounter: (name: string) => {
      const counter = { add: vi.fn() };
      counters.set(name, counter);
      return counter;
    },
    createGauge: (name: string) => {
      const gauge = { record: vi.fn() };
      gauges.set(name, gauge);
      return gauge;
    },
    createHistogram: (name: string) => {
      const histogram = { record: vi.fn() };
      histograms.set(name, histogram);
      return histogram;
    },
  }));
  const startActiveSpan = vi.fn();
  return { counters, gauges, getMeter, histograms, startActiveSpan };
});

vi.mock('@opentelemetry/api', () => ({
  diag: { error: vi.fn() },
  metrics: {
    getMeter: mocks.getMeter,
  },
  SpanStatusCode: { ERROR: 2, OK: 1 },
  trace: {
    getTracer: () => ({
      startActiveSpan: mocks.startActiveSpan,
    }),
  },
}));

describe('full-text search reindex metrics', () => {
  beforeEach(() => {
    for (const counter of mocks.counters.values()) counter.add.mockClear();
    for (const gauge of mocks.gauges.values()) gauge.record.mockClear();
    for (const histogram of mocks.histograms.values()) histogram.record.mockClear();
    mocks.startActiveSpan.mockReset();
  });

  it('records batch and durable checkpoint counts with bounded labels', () => {
    recordFtsSearchReindexBatch({
      checkpoint: { failed: 1, indexed: 8, scanned: 10 },
      entity: 'messages',
      failed: 1,
      indexed: 8,
      scanned: 10,
    });

    const documents = mocks.counters.get('fts_search_reindex_documents_total');
    expect(documents?.add).toHaveBeenCalledWith(10, { entity: 'messages', result: 'scanned' });
    expect(documents?.add).toHaveBeenCalledWith(8, { entity: 'messages', result: 'indexed' });
    expect(documents?.add).toHaveBeenCalledWith(1, { entity: 'messages', result: 'failed' });
    expect(
      mocks.gauges.get('fts_search_reindex_checkpoint_documents')?.record,
    ).toHaveBeenCalledWith(10, { entity: 'messages', result: 'scanned' });
  });

  it('records signed reconciliation drift without run or document identifiers', () => {
    recordFtsSearchReindexReconciliation({
      checkpointCount: 10,
      elasticsearchCount: 12,
      entity: 'messages',
    });

    expect(
      mocks.gauges.get('fts_search_reindex_reconciliation_drift')?.record,
    ).toHaveBeenCalledWith(2, { entity: 'messages' });
    expect(
      mocks.counters.get('fts_search_reindex_reconciliations_total')?.add,
    ).toHaveBeenCalledWith(1, {
      entity: 'messages',
      result: 'drift',
    });
  });

  it('records bulk retries without status or error labels', () => {
    recordFtsSearchReindexBulkRetry('messages');

    expect(mocks.counters.get('fts_search_reindex_bulk_retries_total')?.add).toHaveBeenCalledWith(
      1,
      {
        entity: 'messages',
      },
    );
  });

  it('records each completed bulk request for batch-size and concurrency tuning', () => {
    recordFtsSearchReindexBulkRequest({
      attempts: 2,
      bytes: 4096,
      durationMs: 750,
      entity: 'messages',
      operations: 100,
      result: 'success',
    });

    const attributes = { entity: 'messages', result: 'success' };
    expect(mocks.counters.get('fts_search_reindex_bulk_requests_total')?.add).toHaveBeenCalledWith(
      2,
      attributes,
    );
    expect(mocks.counters.get('fts_search_reindex_bulk_bytes_total')?.add).toHaveBeenCalledWith(
      8192,
      attributes,
    );
    expect(
      mocks.histograms.get('fts_search_reindex_bulk_request_attempts')?.record,
    ).toHaveBeenCalledWith(2, attributes);
    expect(
      mocks.histograms.get('fts_search_reindex_bulk_request_size')?.record,
    ).toHaveBeenCalledWith(4096, attributes);
    expect(
      mocks.histograms.get('fts_search_reindex_bulk_request_duration')?.record,
    ).toHaveBeenCalledWith(750, attributes);
    expect(
      mocks.histograms.get('fts_search_reindex_bulk_request_items')?.record,
    ).toHaveBeenCalledWith(100, attributes);
  });

  it('does not expose metric recorder failures to the reindex operation', () => {
    recordFtsSearchReindexBulkRetry('messages');
    const add = mocks.counters.get('fts_search_reindex_bulk_retries_total')!.add;
    add.mockClear();
    add.mockImplementationOnce(() => {
      throw new Error('telemetry unavailable');
    });

    expect(() => recordFtsSearchReindexBulkRetry('messages')).not.toThrow();
  });

  it('adds bounded failure type and stage attributes to failed run spans', async () => {
    const span = {
      end: vi.fn(),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
    };
    mocks.startActiveSpan.mockImplementation(async (_name, operation) => operation(span));
    const requestError = new Error('request body contains document and query details');
    requestError.name = 'FtsSearchReindexRequestError';
    const entityError = new Error('entity contains a document identifier', { cause: requestError });
    entityError.name = 'FtsSearchReindexEntityError';

    await expect(
      observeFtsSearchReindexRun(async () => {
        throw entityError;
      }),
    ).rejects.toBe(entityError);

    expect(mocks.startActiveSpan).toHaveBeenCalledWith(
      'fts.search.reindex.run',
      expect.any(Function),
    );
    expect(span.setAttribute).toHaveBeenCalledWith('fts.search.reindex.result', 'error');
    expect(span.setAttributes).toHaveBeenCalledWith({
      'fts.search.reindex.error.type': 'request_error',
      'fts.search.reindex.failure.stage': 'entity',
    });
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
  });
});

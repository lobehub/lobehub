import type { Attributes, Span } from '@opentelemetry/api';
import { diag, metrics, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('search-reindex');

const createInstruments = () => {
  const meter = metrics.getMeter('search-reindex');
  return {
    bulkRequestAttempts: meter.createHistogram('search_reindex_bulk_request_attempts', {
      description: 'Attempts required by each completed Elasticsearch bulk request.',
    }),
    bulkRequestBytes: meter.createHistogram('search_reindex_bulk_request_size', {
      description: 'Encoded bytes in each completed Elasticsearch bulk request.',
      unit: 'By',
    }),
    bulkRequestDuration: meter.createHistogram('search_reindex_bulk_request_duration', {
      description: 'Duration of each completed Elasticsearch bulk request including retries.',
      unit: 'ms',
    }),
    bulkRequestItems: meter.createHistogram('search_reindex_bulk_request_items', {
      description: 'Documents in each completed Elasticsearch bulk request.',
    }),
    bulkBytes: meter.createCounter('search_reindex_bulk_bytes_total', {
      description:
        'Encoded bytes included in Elasticsearch bulk request attempts by search reindex.',
      unit: 'By',
    }),
    bulkRequests: meter.createCounter('search_reindex_bulk_requests_total', {
      description: 'Elasticsearch bulk request attempts issued by search reindex.',
      unit: '{request}',
    }),
    bulkRetries: meter.createCounter('search_reindex_bulk_retries_total', {
      description: 'Elasticsearch bulk request retries issued by search reindex.',
      unit: '{retry}',
    }),
    checkpointDocuments: meter.createGauge('search_reindex_checkpoint_documents', {
      description: 'Durable search reindex checkpoint counts grouped by entity and result.',
      unit: '{document}',
    }),
    documentCounter: meter.createCounter('search_reindex_documents_total', {
      description: 'Search reindex documents grouped by entity and result.',
      unit: '{document}',
    }),
    reconciliationCounter: meter.createCounter('search_reindex_reconciliations_total', {
      description: 'Search reindex count reconciliations grouped by entity and result.',
      unit: '{reconciliation}',
    }),
    reconciliationDrift: meter.createGauge('search_reindex_reconciliation_drift', {
      description: 'Elasticsearch document count minus the durable reindex checkpoint count.',
      unit: '{document}',
    }),
    runCounter: meter.createCounter('search_reindex_runs_total', {
      description: 'Search reindex executions grouped by result.',
      unit: '{run}',
    }),
  };
};

let instruments: ReturnType<typeof createInstruments> | undefined;

/** The CLI imports this module before registering OTEL, so bind instruments only on first use. */
const getInstruments = () => (instruments ??= createInstruments());

export interface SearchReindexCheckpointMetrics {
  failed: number;
  indexed: number;
  scanned: number;
}

export interface SearchReindexBatchMetrics {
  checkpoint: SearchReindexCheckpointMetrics;
  entity: string;
  failed: number;
  indexed: number;
  scanned: number;
}

export interface SearchReindexReconciliationMetrics {
  checkpointCount: number;
  elasticsearchCount: number;
  entity: string;
}

export interface SearchReindexBulkRequestMetrics {
  attempts: number;
  bytes: number;
  durationMs: number;
  entity: string;
  operations: number;
  result: 'request_error' | 'response_error' | 'success';
}

const documentAttributes = (entity: string, result: 'failed' | 'indexed' | 'scanned') => ({
  entity,
  result,
});

const recordSafely = (operation: string, record: () => void): void => {
  try {
    record();
  } catch (error) {
    /** A telemetry outage must never interrupt durable reindex progress. */
    diag.error(`[search-reindex] failed to record ${operation}`, error);
  }
};

export const recordSearchReindexBatch = (batch: SearchReindexBatchMetrics): void => {
  recordSafely('batch metrics', () => {
    const { checkpointDocuments, documentCounter } = getInstruments();
    documentCounter.add(batch.scanned, documentAttributes(batch.entity, 'scanned'));
    documentCounter.add(batch.indexed, documentAttributes(batch.entity, 'indexed'));
    documentCounter.add(batch.failed, documentAttributes(batch.entity, 'failed'));
    checkpointDocuments.record(
      batch.checkpoint.scanned,
      documentAttributes(batch.entity, 'scanned'),
    );
    checkpointDocuments.record(
      batch.checkpoint.indexed,
      documentAttributes(batch.entity, 'indexed'),
    );
    checkpointDocuments.record(batch.checkpoint.failed, documentAttributes(batch.entity, 'failed'));
  });
};

export const recordSearchReindexReconciliation = (
  reconciliation: SearchReindexReconciliationMetrics,
): void => {
  recordSafely('reconciliation metrics', () => {
    const { reconciliationCounter, reconciliationDrift } = getInstruments();
    const drift = reconciliation.elasticsearchCount - reconciliation.checkpointCount;
    reconciliationDrift.record(drift, { entity: reconciliation.entity });
    reconciliationCounter.add(1, {
      entity: reconciliation.entity,
      result: drift === 0 ? 'match' : 'drift',
    });
  });
};

export const recordSearchReindexBulkRetry = (entity: string): void => {
  recordSafely('bulk retry metrics', () => getInstruments().bulkRetries.add(1, { entity }));
};

export const recordSearchReindexBulkRequest = (request: SearchReindexBulkRequestMetrics): void => {
  recordSafely('bulk request metrics', () => {
    const {
      bulkBytes,
      bulkRequestAttempts,
      bulkRequestBytes,
      bulkRequestDuration,
      bulkRequestItems,
      bulkRequests,
    } = getInstruments();
    const attributes = { entity: request.entity, result: request.result };
    bulkRequests.add(request.attempts, attributes);
    bulkBytes.add(request.bytes * request.attempts, attributes);
    bulkRequestAttempts.record(request.attempts, attributes);
    bulkRequestBytes.record(request.bytes, attributes);
    bulkRequestDuration.record(request.durationMs, attributes);
    bulkRequestItems.record(request.operations, attributes);
  });
};

const finishRun = (span: Span, result: 'error' | 'success') => {
  const attributes: Attributes = { result };
  recordSafely('run result', () => {
    getInstruments().runCounter.add(1, attributes);
    span.setAttribute('result', result);
    span.setStatus({ code: result === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
  });
  try {
    span.end();
  } catch (error) {
    diag.error('[search-reindex] failed to end telemetry run', error);
  }
};

/** Creates one root span for the reindex CLI execution. */
export const observeSearchReindexRun = async <Result>(
  operation: () => Promise<Result>,
): Promise<Result> =>
  tracer.startActiveSpan('search.reindex.run', async (span) => {
    try {
      const result = await operation();
      finishRun(span, 'success');
      return result;
    } catch (error) {
      finishRun(span, 'error');
      throw error;
    }
  });

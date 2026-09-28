import { errorCauseFrom, errorNameFrom } from '@lobechat/utils';
import type { Attributes, Span } from '@opentelemetry/api';
import { diag, metrics, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('fts-search-reindex');

const createInstruments = () => {
  const meter = metrics.getMeter('fts-search-reindex');
  return {
    bulkRequestAttempts: meter.createHistogram('fts_search_reindex_bulk_request_attempts', {
      description: 'Attempts required by each completed Elasticsearch bulk request.',
    }),
    bulkRequestBytes: meter.createHistogram('fts_search_reindex_bulk_request_size', {
      description: 'Encoded bytes in each completed Elasticsearch bulk request.',
      unit: 'By',
    }),
    bulkRequestDuration: meter.createHistogram('fts_search_reindex_bulk_request_duration', {
      description: 'Duration of each completed Elasticsearch bulk request including retries.',
      unit: 'ms',
    }),
    bulkRequestItems: meter.createHistogram('fts_search_reindex_bulk_request_items', {
      description: 'Documents in each completed Elasticsearch bulk request.',
    }),
    bulkBytes: meter.createCounter('fts_search_reindex_bulk_bytes_total', {
      description:
        'Encoded bytes included in Elasticsearch bulk request attempts by full-text search reindex.',
      unit: 'By',
    }),
    bulkRequests: meter.createCounter('fts_search_reindex_bulk_requests_total', {
      description: 'Elasticsearch bulk request attempts issued by full-text search reindex.',
      unit: '{request}',
    }),
    bulkRetries: meter.createCounter('fts_search_reindex_bulk_retries_total', {
      description: 'Elasticsearch bulk request retries issued by full-text search reindex.',
      unit: '{retry}',
    }),
    checkpointDocuments: meter.createGauge('fts_search_reindex_checkpoint_documents', {
      description:
        'Durable full-text search reindex checkpoint counts grouped by entity and result.',
      unit: '{document}',
    }),
    documentCounter: meter.createCounter('fts_search_reindex_documents_total', {
      description: 'Full-text search reindex documents grouped by entity and result.',
      unit: '{document}',
    }),
    reconciliationCounter: meter.createCounter('fts_search_reindex_reconciliations_total', {
      description: 'Full-text search reindex count reconciliations grouped by entity and result.',
      unit: '{reconciliation}',
    }),
    reconciliationDrift: meter.createGauge('fts_search_reindex_reconciliation_drift', {
      description: 'Elasticsearch document count minus the durable reindex checkpoint count.',
      unit: '{document}',
    }),
    runCounter: meter.createCounter('fts_search_reindex_runs_total', {
      description: 'Full-text search reindex executions grouped by result.',
      unit: '{run}',
    }),
  };
};

let instruments: ReturnType<typeof createInstruments> | undefined;

/** The CLI imports this module before registering OTEL, so bind instruments only on first use. */
const getInstruments = () => (instruments ??= createInstruments());

export interface FtsSearchReindexCheckpointMetrics {
  failed: number;
  indexed: number;
  scanned: number;
}

export interface FtsSearchReindexBatchMetrics {
  checkpoint: FtsSearchReindexCheckpointMetrics;
  entity: string;
  failed: number;
  indexed: number;
  scanned: number;
}

export interface FtsSearchReindexReconciliationMetrics {
  checkpointCount: number;
  elasticsearchCount: number;
  entity: string;
}

export interface FtsSearchReindexBulkRequestMetrics {
  attempts: number;
  bytes: number;
  durationMs: number;
  entity: string;
  operations: number;
  result: 'request_error' | 'response_error' | 'success';
}

type FtsSearchReindexRunFailureStage = 'entity' | 'request' | 'unknown';
type FtsSearchReindexRunFailureType = 'entity_error' | 'request_error' | 'unknown_error';

interface FtsSearchReindexRunFailure {
  stage: FtsSearchReindexRunFailureStage;
  type: FtsSearchReindexRunFailureType;
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
    diag.error(`[fts-search-reindex] failed to record ${operation}`, error);
  }
};

export const recordFtsSearchReindexBatch = (batch: FtsSearchReindexBatchMetrics): void => {
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

export const recordFtsSearchReindexReconciliation = (
  reconciliation: FtsSearchReindexReconciliationMetrics,
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

export const recordFtsSearchReindexBulkRetry = (entity: string): void => {
  recordSafely('bulk retry metrics', () => getInstruments().bulkRetries.add(1, { entity }));
};

export const recordFtsSearchReindexBulkRequest = (
  request: FtsSearchReindexBulkRequestMetrics,
): void => {
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

/** Maps known reindex errors to fixed labels so traces never expose error messages or identifiers. */
const classifyFtsSearchReindexRunFailure = (error: unknown): FtsSearchReindexRunFailure => {
  const errorName = errorNameFrom(error);
  if (errorName === 'FtsSearchReindexRequestError') {
    return { stage: 'request', type: 'request_error' };
  }
  if (errorName === 'FtsSearchReindexEntityError') {
    return {
      stage: 'entity',
      type:
        errorNameFrom(errorCauseFrom(error)) === 'FtsSearchReindexRequestError'
          ? 'request_error'
          : 'entity_error',
    };
  }
  return { stage: 'unknown', type: 'unknown_error' };
};

const finishRun = (
  span: Span,
  result: 'error' | 'success',
  failure?: FtsSearchReindexRunFailure,
) => {
  const attributes: Attributes = { result };
  recordSafely('run result', () => {
    getInstruments().runCounter.add(1, attributes);
    span.setAttribute('fts.search.reindex.result', result);
    if (failure) {
      span.setAttributes({
        'fts.search.reindex.error.type': failure.type,
        'fts.search.reindex.failure.stage': failure.stage,
      });
    }
    span.setStatus({ code: result === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
  });
  try {
    span.end();
  } catch (error) {
    diag.error('[fts-search-reindex] failed to end telemetry run', error);
  }
};

/** Creates one root span for the reindex CLI execution. */
export const observeFtsSearchReindexRun = async <Result>(
  operation: () => Promise<Result>,
): Promise<Result> =>
  tracer.startActiveSpan('fts.search.reindex.run', async (span) => {
    try {
      const result = await operation();
      finishRun(span, 'success');
      return result;
    } catch (error) {
      finishRun(span, 'error', classifyFtsSearchReindexRunFailure(error));
      throw error;
    }
  });

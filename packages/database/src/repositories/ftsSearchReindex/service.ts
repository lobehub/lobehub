import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { FtsSearchDocumentBuilder } from '../ftsSearchDocument';
import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  getFtsSearchIndexAlias,
} from '../ftsSearchDocument';
import type {
  FtsSearchReindexBatchFailure,
  FtsSearchReindexFileRepository,
  FtsSearchReindexRunState,
} from '.';

export interface FtsSearchReindexBulkItemResult {
  error?: unknown;
  status: number;
}

export interface FtsSearchReindexElasticsearchClient {
  bulk: (body: string) => Promise<FtsSearchReindexBulkItemResult[]>;
  count: (index: string) => Promise<number>;
  ensureAlias: (alias: string, physicalIndex: string) => Promise<void>;
  ensureIndex: (
    index: string,
    body: FtsSearchReindexIndexBody,
    options?: FtsSearchReindexIndexOptions,
  ) => Promise<void>;
  refresh: (index: string) => Promise<void>;
}

export interface FtsSearchReindexIndexOptions {
  createIfMissing?: boolean;
}

export interface FtsSearchReindexIndexBody {
  mappings: (typeof FTS_SEARCH_INDEX_DEFINITIONS)[FtsSearchDocumentEntity]['mappings'] & {
    _meta: { reindex_run_id: string; schema_version: number };
  };
  settings: { analysis: typeof FTS_SEARCH_INDEX_ANALYSIS };
}

export interface FtsSearchReindexServiceOptions {
  batchSize: number;
  bulkConcurrency: number;
  bulkMaxBytes: number;
  entityConcurrency: number;
  maxBatchesPerEntity?: number;
  maxRequestRetries: number;
  onProgress: (event: FtsSearchReindexProgressEvent) => Promise<void> | void;
  retryBaseDelayMs: number;
  validateIncrementalSyncSource: () => Promise<void> | void;
}

export type FtsSearchReindexStateRepository = Pick<
  FtsSearchReindexFileRepository,
  | 'checkpointBatch'
  | 'completeEntity'
  | 'createOrResume'
  | 'getRun'
  | 'listUnresolvedFailures'
  | 'markReadyForIncrementalSync'
  | 'resolveFailures'
>;

export type FtsSearchReindexProgressEvent =
  | {
      bulkRequests: number;
      bytes: number;
      cursor: string;
      durationMs: number;
      entity: FtsSearchDocumentEntity;
      failed: number;
      indexed: number;
      processed: number;
      checkpoint: { failed: number; indexed: number; scanned: number };
      type: 'batch';
    }
  | { count: number; entity: FtsSearchDocumentEntity; type: 'entity_completed' }
  | {
      actualCursor: string | null;
      entity: FtsSearchDocumentEntity;
      expectedCursor: string | null;
      type: 'checkpoint_conflict';
    }
  | {
      attempt: number;
      delayMs: number;
      entity: FtsSearchDocumentEntity;
      errorType: string;
      status?: number;
      type: 'bulk_retry';
    }
  | {
      attempts: number;
      bytes: number;
      durationMs: number;
      entity: FtsSearchDocumentEntity;
      operations: number;
      result: 'request_error' | 'response_error' | 'success';
      type: 'bulk_completed';
    }
  | { entity: FtsSearchDocumentEntity; type: 'entity_started' }
  | {
      checkpointCount: number;
      drift: number;
      elasticsearchCount: number;
      entity: FtsSearchDocumentEntity;
      type: 'reconciliation';
    }
  | { type: 'aliases_created' }
  | { type: 'run_paused' };

export interface FtsSearchReindexResult {
  runId: string;
  status: FtsSearchReindexRunState['run']['status'];
}

export class FtsSearchReindexEntityError extends Error {
  constructor(
    readonly entity: FtsSearchDocumentEntity,
    cause: unknown,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`FTS reindex failed for ${entity}: ${causeMessage}`, { cause });
    this.name = 'FtsSearchReindexEntityError';
  }
}

interface BulkOperation {
  body: string;
  bytes: number;
  documentId: string;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_BULK_CONCURRENCY = 1;
const DEFAULT_BULK_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_ENTITY_CONCURRENCY = 1;
const DEFAULT_MAX_REQUEST_RETRIES = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const textEncoder = new TextEncoder();

const errorStatus = (error: unknown) =>
  isRecord(error) && typeof error.status === 'number' ? error.status : undefined;

const isRetryableRequestError = (error: unknown) => {
  const status = errorStatus(error);
  return status === undefined || status === 408 || status === 429 || status >= 500;
};

const errorType = (error: unknown) =>
  error instanceof Error ? error.name.slice(0, 128) : 'UnknownError';

const sleep = (durationMs: number) =>
  durationMs > 0 ? new Promise((resolve) => setTimeout(resolve, durationMs)) : Promise.resolve();

const mapWithConcurrency = async <Item, Result>(
  items: readonly Item[],
  concurrency: number,
  operation: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> => {
  const results: ({ value: Result } | undefined)[] = Array.from({ length: items.length });
  let nextIndex = 0;
  let firstFailure: { error: unknown } | undefined;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!firstFailure) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = { value: await operation(items[index], index) };
      } catch (error) {
        firstFailure ??= { error };
      }
    }
  });
  await Promise.all(workers);
  if (firstFailure) throw firstFailure.error;
  return results.map((result, index) => {
    if (!result) throw new Error(`Missing concurrent operation result at index ${index}`);
    return result.value;
  });
};

const isPermanentElasticsearchStatus = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;

const describeBulkError = (status: number, error: unknown) => {
  const type =
    isRecord(error) && typeof error.type === 'string' ? error.type.slice(0, 128) : 'unknown';
  return new Error(`Elasticsearch bulk item failed (${status}, type=${type})`);
};

const buildBulkOperation = (
  documentId: string,
  index: string,
  revision: number,
  source: Record<string, unknown>,
): BulkOperation => {
  const metadata = {
    index: {
      _id: documentId,
      _index: index,
      version: revision,
      version_type: 'external_gte',
    },
  };
  const body = `${JSON.stringify(metadata)}\n${JSON.stringify(source)}\n`;
  return { body, bytes: textEncoder.encode(body).byteLength, documentId };
};

/** Resumable full backfill that leaves product reads on PostgreSQL. */
export class FtsSearchReindexService {
  private readonly options: FtsSearchReindexServiceOptions;
  private preparedRunId?: string;

  constructor(
    private readonly builder: Pick<FtsSearchDocumentBuilder, 'buildBatch' | 'buildByIds'>,
    private readonly repository: FtsSearchReindexStateRepository,
    private readonly client: FtsSearchReindexElasticsearchClient,
    options: Partial<FtsSearchReindexServiceOptions> = {},
  ) {
    this.options = {
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      bulkConcurrency: options.bulkConcurrency ?? DEFAULT_BULK_CONCURRENCY,
      bulkMaxBytes: options.bulkMaxBytes ?? DEFAULT_BULK_MAX_BYTES,
      entityConcurrency: options.entityConcurrency ?? DEFAULT_ENTITY_CONCURRENCY,
      maxBatchesPerEntity: options.maxBatchesPerEntity,
      maxRequestRetries: options.maxRequestRetries ?? DEFAULT_MAX_REQUEST_RETRIES,
      onProgress: options.onProgress ?? (() => {}),
      retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      validateIncrementalSyncSource: options.validateIncrementalSyncSource ?? (() => {}),
    };
    if (!Number.isInteger(this.options.batchSize) || this.options.batchSize < 1) {
      throw new Error('FTS reindex batch size must be a positive integer');
    }
    if (!Number.isInteger(this.options.bulkMaxBytes) || this.options.bulkMaxBytes < 1) {
      throw new Error('FTS reindex bulk byte limit must be a positive integer');
    }
    if (!Number.isInteger(this.options.bulkConcurrency) || this.options.bulkConcurrency < 1) {
      throw new Error('FTS reindex bulk concurrency must be a positive integer');
    }
    if (!Number.isInteger(this.options.entityConcurrency) || this.options.entityConcurrency < 1) {
      throw new Error('FTS reindex entity concurrency must be a positive integer');
    }
    if (
      this.options.maxBatchesPerEntity !== undefined &&
      (!Number.isInteger(this.options.maxBatchesPerEntity) || this.options.maxBatchesPerEntity < 1)
    ) {
      throw new Error('FTS reindex maximum batches per entity must be a positive integer');
    }
    if (!Number.isInteger(this.options.maxRequestRetries) || this.options.maxRequestRetries < 0) {
      throw new Error('FTS reindex request retries must be a non-negative integer');
    }
    if (!Number.isInteger(this.options.retryBaseDelayMs) || this.options.retryBaseDelayMs < 0) {
      throw new Error('FTS reindex retry delay must be a non-negative integer');
    }
  }

  private async emitProgress(event: FtsSearchReindexProgressEvent) {
    await this.options.onProgress(event);
  }

  /**
   * Create and validate every physical index before the backfill starts so required Elasticsearch
   * analysis capabilities, including analysis-icu, fail fast.
   */
  async prepareIndices(state: FtsSearchReindexRunState): Promise<void> {
    if (this.preparedRunId === state.run.id) return;

    await mapWithConcurrency(
      state.progress,
      this.options.entityConcurrency,
      async ({ entity, physicalIndex, status }) => {
        try {
          await this.client.ensureIndex(
            physicalIndex,
            {
              mappings: {
                ...FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings,
                _meta: {
                  reindex_run_id: state.run.id,
                  schema_version: state.run.schemaVersion,
                },
              },
              settings: { analysis: FTS_SEARCH_INDEX_ANALYSIS },
            },
            { createIfMissing: status !== 'completed' },
          );
        } catch (error) {
          throw new FtsSearchReindexEntityError(entity, error);
        }
      },
    );
    this.preparedRunId = state.run.id;
  }

  private async flushBulk(
    entity: FtsSearchDocumentEntity,
    operations: BulkOperation[],
  ): Promise<{
    failures: FtsSearchReindexBatchFailure[];
    indexedDocumentIds: string[];
  }> {
    if (operations.length === 0) return { failures: [], indexedDocumentIds: [] };

    const body = operations.map((operation) => operation.body).join('');
    const bytes = operations.reduce((total, operation) => total + operation.bytes, 0);
    const startedAt = Date.now();
    let attempts = 0;
    let results: FtsSearchReindexBulkItemResult[];
    while (true) {
      attempts += 1;
      try {
        results = await this.client.bulk(body);
        break;
      } catch (error) {
        if (!isRetryableRequestError(error) || attempts > this.options.maxRequestRetries) {
          await this.emitProgress({
            attempts,
            bytes,
            durationMs: Date.now() - startedAt,
            entity,
            operations: operations.length,
            result: 'request_error',
            type: 'bulk_completed',
          });
          throw error;
        }
        const exponentialDelay = this.options.retryBaseDelayMs * 2 ** (attempts - 1);
        const delayMs = Math.floor(Math.random() * exponentialDelay);
        await this.emitProgress({
          attempt: attempts,
          delayMs,
          entity,
          errorType: errorType(error),
          status: errorStatus(error),
          type: 'bulk_retry',
        });
        await sleep(delayMs);
      }
    }
    if (results.length !== operations.length) {
      await this.emitProgress({
        attempts,
        bytes,
        durationMs: Date.now() - startedAt,
        entity,
        operations: operations.length,
        result: 'response_error',
        type: 'bulk_completed',
      });
      throw new Error(
        `Elasticsearch bulk returned ${results.length} items for ${operations.length} operations`,
      );
    }
    await this.emitProgress({
      attempts,
      bytes,
      durationMs: Date.now() - startedAt,
      entity,
      operations: operations.length,
      result: 'success',
      type: 'bulk_completed',
    });

    const failures: FtsSearchReindexBatchFailure[] = [];
    const indexedDocumentIds: string[] = [];
    for (const [index, operation] of operations.entries()) {
      const result = results[index];
      if ((result.status >= 200 && result.status < 300) || result.status === 409) {
        indexedDocumentIds.push(operation.documentId);
      } else {
        failures.push({
          documentId: operation.documentId,
          error: describeBulkError(result.status, result.error),
          retryable: !isPermanentElasticsearchStatus(result.status),
        });
      }
    }

    return { failures, indexedDocumentIds };
  }

  private async indexDocuments(
    documents: { id: string; source: Record<string, unknown> }[],
    entity: FtsSearchDocumentEntity,
    physicalIndex: string,
    revision: number,
  ) {
    const failures: FtsSearchReindexBatchFailure[] = [];
    const indexedDocumentIds: string[] = [];
    const inFlight = new Set<Promise<void>>();
    let bulkRequests = 0;
    let bytes = 0;
    let firstFailure: { error: unknown } | undefined;
    let bulk: BulkOperation[] = [];
    let bulkBytes = 0;

    const waitForAvailableSlot = async () => {
      if (inFlight.size < this.options.bulkConcurrency) return;
      await Promise.race(inFlight);
      if (firstFailure) {
        await Promise.all(inFlight);
        throw firstFailure.error;
      }
    };

    const flushQueuedBulk = async () => {
      if (bulk.length === 0) return;
      const operations = bulk;
      bulkRequests += 1;
      bytes += bulkBytes;
      bulk = [];
      bulkBytes = 0;
      const task = this.flushBulk(entity, operations)
        .then((result) => {
          failures.push(...result.failures);
          indexedDocumentIds.push(...result.indexedDocumentIds);
        })
        .catch((error) => {
          firstFailure ??= { error };
        });
      inFlight.add(task);
      void task.then(() => inFlight.delete(task));
      await waitForAvailableSlot();
    };

    for (const document of documents) {
      const operation = buildBulkOperation(document.id, physicalIndex, revision, document.source);
      if (operation.bytes > this.options.bulkMaxBytes) {
        failures.push({
          documentId: document.id,
          error: new Error(
            `FTS search document is ${operation.bytes} bytes and exceeds the ${this.options.bulkMaxBytes}-byte bulk limit`,
          ),
          retryable: false,
        });
        continue;
      }
      if (bulk.length > 0 && bulkBytes + operation.bytes > this.options.bulkMaxBytes) {
        await flushQueuedBulk();
      }
      bulk.push(operation);
      bulkBytes += operation.bytes;
    }
    await flushQueuedBulk();
    await Promise.all(inFlight);
    if (firstFailure) throw firstFailure.error;

    return {
      bulkRequests,
      bytes,
      failures,
      indexedDocumentIds,
    };
  }

  private async retryFailures(state: FtsSearchReindexRunState, entity: FtsSearchDocumentEntity) {
    const failures = await this.repository.listUnresolvedFailures(state.run.id, entity);
    if (failures.length === 0) return;

    const documents = await this.builder.buildByIds(
      entity,
      failures.map(({ documentId }) => documentId),
    );
    const sources = new Map(
      documents.map((document) => [document.id, document.source as Record<string, unknown>]),
    );
    const progress = state.progress.find((item) => item.entity === entity);
    if (!progress) throw new Error(`Missing reindex progress for ${entity}`);

    const retryDocuments = failures.map(({ documentId }) => ({
      id: documentId,
      /** A source row deleted during backfill remains versioned until the outbox applies its deletion. */
      source:
        sources.get(documentId) ??
        ({ id: documentId, fts_search_sync_deleted: true } as Record<string, unknown>),
    }));
    const result = await this.indexDocuments(
      retryDocuments,
      entity,
      progress.physicalIndex,
      state.run.baseRevision,
    );
    await this.repository.resolveFailures(state.run.id, entity, result.indexedDocumentIds);
    if (result.failures.length > 0) {
      const checkpointed = await this.repository.checkpointBatch({
        cursor: progress.cursor ?? '',
        entity,
        failures: result.failures,
        indexedCount: 0,
        previousCursor: progress.cursor,
        processedCount: 0,
        runId: state.run.id,
      });
      if (!checkpointed) {
        const refreshed = await this.repository.getRun(state.run.id);
        await this.emitProgress({
          actualCursor: refreshed?.progress.find((item) => item.entity === entity)?.cursor ?? null,
          entity,
          expectedCursor: progress.cursor,
          type: 'checkpoint_conflict',
        });
      }
    }
  }

  private async runEntity(state: FtsSearchReindexRunState, entity: FtsSearchDocumentEntity) {
    let progress = state.progress.find((item) => item.entity === entity);
    if (!progress) throw new Error(`Missing reindex progress for ${entity}`);
    if (progress.status === 'completed') return true;

    await this.emitProgress({ entity, type: 'entity_started' });

    let processedBatches = 0;
    let sourceExhausted = false;
    while (true) {
      const batchStartedAt = Date.now();
      const documents = await this.builder.buildBatch(entity, {
        afterId: progress.cursor ?? undefined,
        limit: this.options.batchSize,
      });
      if (documents.length === 0) {
        sourceExhausted = true;
        break;
      }

      const result = await this.indexDocuments(
        documents.map((document) => ({
          id: document.id,
          source: document.source as Record<string, unknown>,
        })),
        entity,
        progress.physicalIndex,
        state.run.baseRevision,
      );
      const checkpointed = await this.repository.checkpointBatch({
        cursor: documents.at(-1)!.id,
        entity,
        failures: result.failures,
        indexedCount: result.indexedDocumentIds.length,
        previousCursor: progress.cursor,
        processedCount: documents.length,
        runId: state.run.id,
      });
      const refreshed = await this.repository.getRun(state.run.id);
      const checkpointProgress = refreshed?.progress.find((item) => item.entity === entity);
      if (checkpointed) {
        if (!checkpointProgress)
          throw new Error(`Missing refreshed reindex progress for ${entity}`);
        await this.emitProgress({
          bulkRequests: result.bulkRequests,
          bytes: result.bytes,
          checkpoint: {
            failed: checkpointProgress.failedCount,
            indexed: checkpointProgress.indexedCount,
            scanned: checkpointProgress.processedCount,
          },
          cursor: documents.at(-1)!.id,
          durationMs: Date.now() - batchStartedAt,
          entity,
          failed: result.failures.length,
          indexed: result.indexedDocumentIds.length,
          processed: documents.length,
          type: 'batch',
        });
      } else {
        await this.emitProgress({
          actualCursor: checkpointProgress?.cursor ?? null,
          entity,
          expectedCursor: progress.cursor,
          type: 'checkpoint_conflict',
        });
      }
      progress = checkpointProgress;
      if (!progress) throw new Error(`Missing refreshed reindex progress for ${entity}`);
      processedBatches += 1;
      if (documents.length < this.options.batchSize) {
        /** buildBatch applies LIMIT without post-query filtering, so a short keyset page is final. */
        sourceExhausted = true;
        break;
      }
      if (
        this.options.maxBatchesPerEntity !== undefined &&
        processedBatches >= this.options.maxBatchesPerEntity
      ) {
        break;
      }
    }

    if (!sourceExhausted) return false;

    const refreshedState = await this.repository.getRun(state.run.id);
    if (!refreshedState) throw new Error(`Missing reindex run ${state.run.id}`);
    await this.retryFailures(refreshedState, entity);
    const unresolved = await this.repository.listUnresolvedFailures(state.run.id, entity);
    if (unresolved.length > 0) {
      throw new Error(`Reindex paused with ${unresolved.length} unresolved ${entity} failures`);
    }

    const finalState = await this.repository.getRun(state.run.id);
    const finalProgress = finalState?.progress.find((item) => item.entity === entity);
    if (!finalProgress) throw new Error(`Missing final reindex progress for ${entity}`);
    await this.client.refresh(finalProgress.physicalIndex);
    const indexedCount = await this.client.count(finalProgress.physicalIndex);
    await this.emitProgress({
      checkpointCount: finalProgress.indexedCount,
      drift: indexedCount - finalProgress.indexedCount,
      elasticsearchCount: indexedCount,
      entity,
      type: 'reconciliation',
    });
    if (indexedCount !== finalProgress.indexedCount) {
      throw new Error(
        `Reindex count mismatch for ${entity}: checkpoint=${finalProgress.indexedCount}, Elasticsearch=${indexedCount}`,
      );
    }
    await this.repository.completeEntity(state.run.id, entity);
    await this.emitProgress({ count: indexedCount, entity, type: 'entity_completed' });
    return true;
  }

  async run(namespace: string, schemaVersion: number): Promise<FtsSearchReindexResult> {
    const initialState = await this.repository.createOrResume(namespace, schemaVersion);
    if (initialState.run.status === 'ready_for_incremental_sync') {
      return {
        runId: initialState.run.id,
        status: initialState.run.status,
      };
    }

    await this.prepareIndices(initialState);

    const completed = await mapWithConcurrency(
      FTS_SEARCH_DOCUMENT_ENTITIES,
      this.options.entityConcurrency,
      async (entity) => {
        const currentState = await this.repository.getRun(initialState.run.id);
        if (!currentState) throw new Error(`Missing reindex run ${initialState.run.id}`);
        try {
          return await this.runEntity(currentState, entity);
        } catch (error) {
          throw new FtsSearchReindexEntityError(entity, error);
        }
      },
    );

    if (completed.some((value) => !value)) {
      await this.emitProgress({ type: 'run_paused' });
      return { runId: initialState.run.id, status: 'backfilling' };
    }

    const completedState = await this.repository.getRun(initialState.run.id);
    if (!completedState) throw new Error(`Missing reindex run ${initialState.run.id}`);
    await this.options.validateIncrementalSyncSource();
    for (const progress of completedState.progress) {
      await this.client.ensureAlias(
        getFtsSearchIndexAlias(namespace, progress.entity),
        progress.physicalIndex,
      );
    }
    await this.repository.markReadyForIncrementalSync(initialState.run.id);
    await this.emitProgress({ type: 'aliases_created' });

    return {
      runId: initialState.run.id,
      status: 'ready_for_incremental_sync',
    };
  }
}

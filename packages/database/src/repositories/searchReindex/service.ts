import type { SearchDocumentEntity } from '@lobechat/types';
import { SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { SearchDocumentBuilder } from '../searchDocument';
import {
  getSearchIndexAlias,
  SEARCH_INDEX_ANALYSIS,
  SEARCH_INDEX_DEFINITIONS,
} from '../searchDocument';
import type {
  SearchReindexBatchFailure,
  SearchReindexFileRepository,
  SearchReindexRunState,
} from '.';

export interface SearchReindexBulkItemResult {
  error?: unknown;
  status: number;
}

export interface SearchReindexElasticsearchClient {
  bulk: (body: string) => Promise<SearchReindexBulkItemResult[]>;
  count: (index: string) => Promise<number>;
  ensureAlias: (alias: string, physicalIndex: string) => Promise<void>;
  ensureIndex: (index: string, body: SearchReindexIndexBody) => Promise<void>;
  refresh: (index: string) => Promise<void>;
}

export interface SearchReindexIndexBody {
  mappings: (typeof SEARCH_INDEX_DEFINITIONS)[SearchDocumentEntity]['mappings'] & {
    _meta: { reindex_run_id: string; schema_version: number };
  };
  settings: { analysis: typeof SEARCH_INDEX_ANALYSIS };
}

export interface SearchReindexServiceOptions {
  batchSize: number;
  bulkMaxBytes: number;
  onProgress: (event: SearchReindexProgressEvent) => void;
}

export type SearchReindexStateRepository = Pick<
  SearchReindexFileRepository,
  | 'checkpointBatch'
  | 'completeEntity'
  | 'createOrResume'
  | 'getRun'
  | 'listUnresolvedFailures'
  | 'markReadyForIncrementalSync'
  | 'resolveFailures'
>;

export type SearchReindexProgressEvent =
  | {
      cursor: string;
      entity: SearchDocumentEntity;
      failed: number;
      indexed: number;
      processed: number;
      type: 'batch';
    }
  | { count: number; entity: SearchDocumentEntity; type: 'entity_completed' }
  | {
      actualCursor: string | null;
      entity: SearchDocumentEntity;
      expectedCursor: string | null;
      type: 'checkpoint_conflict';
    }
  | { type: 'aliases_created' };

export interface SearchReindexResult {
  runId: string;
  status: SearchReindexRunState['run']['status'];
}

interface BulkOperation {
  body: string;
  bytes: number;
  documentId: string;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_BULK_MAX_BYTES = 50 * 1024 * 1024;
const textEncoder = new TextEncoder();

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
export class SearchReindexService {
  private readonly options: SearchReindexServiceOptions;

  constructor(
    private readonly builder: Pick<SearchDocumentBuilder, 'buildBatch' | 'buildByIds'>,
    private readonly repository: SearchReindexStateRepository,
    private readonly client: SearchReindexElasticsearchClient,
    options: Partial<SearchReindexServiceOptions> = {},
  ) {
    this.options = {
      batchSize: DEFAULT_BATCH_SIZE,
      bulkMaxBytes: DEFAULT_BULK_MAX_BYTES,
      onProgress: () => {},
      ...options,
    };
    if (!Number.isInteger(this.options.batchSize) || this.options.batchSize < 1) {
      throw new Error('Search reindex batch size must be a positive integer');
    }
    if (!Number.isInteger(this.options.bulkMaxBytes) || this.options.bulkMaxBytes < 1) {
      throw new Error('Search reindex bulk byte limit must be a positive integer');
    }
  }

  private async flushBulk(operations: BulkOperation[]): Promise<{
    failures: SearchReindexBatchFailure[];
    indexedDocumentIds: string[];
  }> {
    if (operations.length === 0) return { failures: [], indexedDocumentIds: [] };

    const results = await this.client.bulk(operations.map(({ body }) => body).join(''));
    if (results.length !== operations.length) {
      throw new Error(
        `Elasticsearch bulk returned ${results.length} items for ${operations.length} operations`,
      );
    }

    const failures: SearchReindexBatchFailure[] = [];
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
    physicalIndex: string,
    revision: number,
  ) {
    const failures: SearchReindexBatchFailure[] = [];
    const indexedDocumentIds: string[] = [];
    let bulk: BulkOperation[] = [];
    let bulkBytes = 0;

    const flush = async () => {
      const result = await this.flushBulk(bulk);
      failures.push(...result.failures);
      indexedDocumentIds.push(...result.indexedDocumentIds);
      bulk = [];
      bulkBytes = 0;
    };

    for (const document of documents) {
      const operation = buildBulkOperation(document.id, physicalIndex, revision, document.source);
      if (operation.bytes > this.options.bulkMaxBytes) {
        failures.push({
          documentId: document.id,
          error: new Error(
            `Search document is ${operation.bytes} bytes and exceeds the ${this.options.bulkMaxBytes}-byte bulk limit`,
          ),
          retryable: false,
        });
        continue;
      }
      if (bulk.length > 0 && bulkBytes + operation.bytes > this.options.bulkMaxBytes) await flush();
      bulk.push(operation);
      bulkBytes += operation.bytes;
    }
    await flush();

    return { failures, indexedDocumentIds };
  }

  private async retryFailures(state: SearchReindexRunState, entity: SearchDocumentEntity) {
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
        ({ id: documentId, search_sync_deleted: true } as Record<string, unknown>),
    }));
    const result = await this.indexDocuments(
      retryDocuments,
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
        this.options.onProgress({
          actualCursor: refreshed?.progress.find((item) => item.entity === entity)?.cursor ?? null,
          entity,
          expectedCursor: progress.cursor,
          type: 'checkpoint_conflict',
        });
      }
    }
  }

  private async runEntity(state: SearchReindexRunState, entity: SearchDocumentEntity) {
    let progress = state.progress.find((item) => item.entity === entity);
    if (!progress) throw new Error(`Missing reindex progress for ${entity}`);
    if (progress.status === 'completed') return;

    await this.client.ensureIndex(progress.physicalIndex, {
      mappings: {
        ...SEARCH_INDEX_DEFINITIONS[entity].mappings,
        _meta: {
          reindex_run_id: state.run.id,
          schema_version: state.run.schemaVersion,
        },
      },
      settings: { analysis: SEARCH_INDEX_ANALYSIS },
    });

    while (true) {
      const documents = await this.builder.buildBatch(entity, {
        afterId: progress.cursor ?? undefined,
        limit: this.options.batchSize,
      });
      if (documents.length === 0) break;

      const result = await this.indexDocuments(
        documents.map((document) => ({
          id: document.id,
          source: document.source as Record<string, unknown>,
        })),
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
      if (checkpointed) {
        this.options.onProgress({
          cursor: documents.at(-1)!.id,
          entity,
          failed: result.failures.length,
          indexed: result.indexedDocumentIds.length,
          processed: documents.length,
          type: 'batch',
        });
      } else {
        const refreshed = await this.repository.getRun(state.run.id);
        this.options.onProgress({
          actualCursor: refreshed?.progress.find((item) => item.entity === entity)?.cursor ?? null,
          entity,
          expectedCursor: progress.cursor,
          type: 'checkpoint_conflict',
        });
      }
      const refreshed = await this.repository.getRun(state.run.id);
      progress = refreshed?.progress.find((item) => item.entity === entity);
      if (!progress) throw new Error(`Missing refreshed reindex progress for ${entity}`);
    }

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
    if (indexedCount !== finalProgress.indexedCount) {
      throw new Error(
        `Reindex count mismatch for ${entity}: checkpoint=${finalProgress.indexedCount}, Elasticsearch=${indexedCount}`,
      );
    }
    await this.repository.completeEntity(state.run.id, entity);
    this.options.onProgress({ count: indexedCount, entity, type: 'entity_completed' });
  }

  async run(namespace: string, schemaVersion: number): Promise<SearchReindexResult> {
    const initialState = await this.repository.createOrResume(namespace, schemaVersion);
    if (initialState.run.status === 'ready_for_incremental_sync') {
      return {
        runId: initialState.run.id,
        status: initialState.run.status,
      };
    }

    for (const entity of SEARCH_DOCUMENT_ENTITIES) {
      const currentState = await this.repository.getRun(initialState.run.id);
      if (!currentState) throw new Error(`Missing reindex run ${initialState.run.id}`);
      await this.runEntity(currentState, entity);
    }

    const completedState = await this.repository.getRun(initialState.run.id);
    if (!completedState) throw new Error(`Missing reindex run ${initialState.run.id}`);
    for (const progress of completedState.progress) {
      await this.client.ensureAlias(
        getSearchIndexAlias(namespace, progress.entity),
        progress.physicalIndex,
      );
    }
    await this.repository.markReadyForIncrementalSync(initialState.run.id);
    this.options.onProgress({ type: 'aliases_created' });

    return {
      runId: initialState.run.id,
      status: 'ready_for_incremental_sync',
    };
  }
}

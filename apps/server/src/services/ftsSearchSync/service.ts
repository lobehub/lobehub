import { Buffer } from 'node:buffer';

import type { FtsSearchDocumentBuilder } from '@/database/repositories/ftsSearchDocument';
import {
  FTS_SEARCH_DOCUMENT_ENTITIES,
  getFtsSearchIndexAlias,
} from '@/database/repositories/ftsSearchDocument';
import type {
  FtsSearchSyncFailure,
  FtsSearchSyncOutboxRepository,
  FtsSearchSyncWork,
} from '@/database/repositories/ftsSearchSyncOutbox';

import type { ElasticsearchFtsSearchBulkResponse } from '../ftsSearch/elasticsearch';

export const FTS_SEARCH_SYNC_BULK_MAX_BYTES = 50 * 1024 * 1024;
export const FTS_SEARCH_SYNC_CLAIM_LIMIT = 100;
export const FTS_SEARCH_SYNC_MAX_BULK_REQUESTS = 2;
export const FTS_SEARCH_SYNC_PROJECTION_BATCH_SIZE = FTS_SEARCH_SYNC_CLAIM_LIMIT;

interface FtsSearchSyncElasticsearchClient {
  bulk: (body: string) => Promise<ElasticsearchFtsSearchBulkResponse>;
}

interface FtsSearchSyncOperation {
  body: string;
  bytes: number;
  work: FtsSearchSyncWork;
}

interface FtsSearchSyncServiceOptions {
  bulkMaxBytes: number;
  claimLimit: number;
  maxBulkRequests: number;
  projectionBatchSize: number;
}

export interface FtsSearchSyncDrainResult {
  acknowledged: number;
  bulkBytes: number;
  bulkItems: number;
  bulkRequests: number;
  bulkRequestSamples: FtsSearchSyncBulkRequestSample[];
  claimed: number;
  dead: number;
  failed: number;
  hasMore: boolean;
  released: number;
}

export type FtsSearchSyncBulkRequestResult =
  'item_error' | 'mixed' | 'request_error' | 'response_error' | 'success';

export interface FtsSearchSyncBulkEntitySample {
  bytes: number;
  items: number;
  result: FtsSearchSyncBulkRequestResult;
}

export interface FtsSearchSyncBulkRequestSample {
  bytes: number;
  durationMs: number;
  entities: Partial<Record<FtsSearchSyncWork['entity'], FtsSearchSyncBulkEntitySample>>;
  items: number;
  result: FtsSearchSyncBulkRequestResult;
}

const workKey = (work: FtsSearchSyncWork) => `${work.entity}:${work.documentId}:${work.revision}`;
const sourceKey = (entity: FtsSearchSyncWork['entity'], documentId: string) =>
  `${entity}:${documentId}`;

const isPermanentElasticsearchStatus = (status: number | undefined) =>
  status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;

const chunks = <Item>(items: Item[], size: number): Item[][] => {
  const result: Item[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
};

const buildOperation = (
  work: FtsSearchSyncWork,
  indexNamespace: string,
  source: Record<string, unknown>,
): FtsSearchSyncOperation => {
  const metadata = {
    index: {
      _id: work.documentId,
      _index: getFtsSearchIndexAlias(indexNamespace, work.entity),
      version: work.revision,
      version_type: 'external',
    },
  };
  const body = `${JSON.stringify(metadata)}\n${JSON.stringify(source)}\n`;
  return { body, bytes: Buffer.byteLength(body), work };
};

const summarizeBulkEntities = (
  operations: FtsSearchSyncOperation[],
  result: FtsSearchSyncBulkRequestResult,
  failedWorkKeys?: Set<string>,
): FtsSearchSyncBulkRequestSample['entities'] => {
  const summaries = new Map<
    FtsSearchSyncWork['entity'],
    { bytes: number; failed: number; items: number }
  >();

  for (const operation of operations) {
    const entity = operation.work.entity;
    const current = summaries.get(entity) ?? { bytes: 0, failed: 0, items: 0 };
    current.bytes += operation.bytes;
    current.items += 1;
    if (failedWorkKeys?.has(workKey(operation.work))) current.failed += 1;
    summaries.set(entity, current);
  }

  const entitySamples: FtsSearchSyncBulkRequestSample['entities'] = {};
  for (const [entity, summary] of summaries) {
    const entityResult =
      failedWorkKeys === undefined
        ? result
        : summary.failed === 0
          ? 'success'
          : summary.failed === summary.items
            ? 'item_error'
            : 'mixed';
    entitySamples[entity] = {
      bytes: summary.bytes,
      items: summary.items,
      result: entityResult,
    };
  }

  return entitySamples;
};

/** Bounded PostgreSQL projection → byte-aware Elasticsearch bulk drain. */
export class FtsSearchSyncService {
  private readonly options: FtsSearchSyncServiceOptions;

  constructor(
    private readonly builder: Pick<FtsSearchDocumentBuilder, 'buildByIds'>,
    private readonly outbox: Pick<
      FtsSearchSyncOutboxRepository,
      | 'acknowledgeMany'
      | 'claim'
      | 'hasActionableWork'
      | 'hasDeadLetters'
      | 'markFailures'
      | 'releaseMany'
    >,
    private readonly client: FtsSearchSyncElasticsearchClient,
    private readonly indexNamespace: string,
    options: Partial<FtsSearchSyncServiceOptions> = {},
  ) {
    this.options = {
      bulkMaxBytes: FTS_SEARCH_SYNC_BULK_MAX_BYTES,
      claimLimit: FTS_SEARCH_SYNC_CLAIM_LIMIT,
      maxBulkRequests: FTS_SEARCH_SYNC_MAX_BULK_REQUESTS,
      projectionBatchSize: FTS_SEARCH_SYNC_PROJECTION_BATCH_SIZE,
      ...options,
    };
  }

  async hasDeadLetters(): Promise<boolean> {
    return this.outbox.hasDeadLetters();
  }

  async drainOnce(): Promise<FtsSearchSyncDrainResult> {
    const works = await this.outbox.claim(this.options.claimLimit);
    if (works.length === 0) {
      return {
        acknowledged: 0,
        bulkBytes: 0,
        bulkItems: 0,
        bulkRequestSamples: [],
        bulkRequests: 0,
        claimed: 0,
        dead: 0,
        failed: 0,
        hasMore: await this.outbox.hasActionableWork(),
        released: 0,
      };
    }

    const unsettled = new Map(works.map((work) => [workKey(work), work]));
    const result: FtsSearchSyncDrainResult = {
      acknowledged: 0,
      bulkBytes: 0,
      bulkItems: 0,
      bulkRequestSamples: [],
      bulkRequests: 0,
      claimed: works.length,
      dead: 0,
      failed: 0,
      hasMore: false,
      released: 0,
    };
    let bulk: FtsSearchSyncOperation[] = [];
    let bulkBytes = 0;

    const forget = (settledWorks: FtsSearchSyncWork[]) => {
      for (const work of settledWorks) unsettled.delete(workKey(work));
    };

    const fail = async (failures: FtsSearchSyncFailure[]) => {
      result.dead += await this.outbox.markFailures(failures);
      result.failed += failures.length;
      forget(failures);
    };

    const flush = async () => {
      if (bulk.length === 0) return;
      const operations = bulk;
      const requestBody = operations.map((operation) => operation.body).join('');
      const requestBytes = bulkBytes;
      bulk = [];
      bulkBytes = 0;
      result.bulkBytes += requestBytes;
      result.bulkItems += operations.length;
      result.bulkRequests += 1;

      let response: ElasticsearchFtsSearchBulkResponse;
      const startedAt = Date.now();
      try {
        response = await this.client.bulk(requestBody);
      } catch (error) {
        result.bulkRequestSamples.push({
          bytes: requestBytes,
          durationMs: Date.now() - startedAt,
          entities: summarizeBulkEntities(operations, 'request_error'),
          items: operations.length,
          result: 'request_error',
        });
        /** Request-level failures can be deployment or proxy faults; retry every item durably. */
        await fail(operations.map(({ work }) => ({ ...work, error })));
        return;
      }

      if (response.items.length !== operations.length) {
        result.bulkRequestSamples.push({
          bytes: requestBytes,
          durationMs: Date.now() - startedAt,
          entities: summarizeBulkEntities(operations, 'response_error'),
          items: operations.length,
          result: 'response_error',
        });
        await fail(
          operations.map(({ work }) => ({
            ...work,
            error: new Error(
              `Elasticsearch bulk returned ${response.items.length} items for ${operations.length} operations`,
            ),
          })),
        );
        return;
      }

      const acknowledged: FtsSearchSyncWork[] = [];
      const failures: FtsSearchSyncFailure[] = [];
      for (const [index, operation] of operations.entries()) {
        const item = response.items[index].index;
        if ((item.status >= 200 && item.status < 300) || item.status === 409) {
          /**
           * A version conflict is safe to settle because two database fences preserve source order:
           * fresh reindexes reserve their base revision before capture activation, and same-document
           * Outbox upserts allocate a revision only after locking the unique Outbox row. Settlement
           * is also revision-and-lease fenced, so a concurrent refresh remains queued.
           */
          acknowledged.push(operation.work);
        } else {
          failures.push({
            ...operation.work,
            error: new Error(`Elasticsearch bulk item failed (${item.status})`),
            permanent: isPermanentElasticsearchStatus(item.status),
          });
        }
      }

      const bulkResult =
        failures.length === 0 ? 'success' : acknowledged.length === 0 ? 'item_error' : 'mixed';
      result.bulkRequestSamples.push({
        bytes: requestBytes,
        durationMs: Date.now() - startedAt,
        entities: summarizeBulkEntities(operations, bulkResult, new Set(failures.map(workKey))),
        items: operations.length,
        result: bulkResult,
      });

      const deleted = await this.outbox.acknowledgeMany(acknowledged);
      result.acknowledged += deleted.length;
      forget(acknowledged);
      await fail(failures);
    };

    let hasPrimaryError = false;
    let hasReleaseError = false;
    let releaseError: unknown;
    try {
      const supportedEntities = new Set<string>(FTS_SEARCH_DOCUMENT_ENTITIES);
      const unsupportedWorks = works.filter((work) => !supportedEntities.has(work.entity));
      if (unsupportedWorks.length > 0) {
        await fail(
          unsupportedWorks.map((work) => ({
            ...work,
            error: new Error(`Unsupported full-text search sync entity: ${work.entity}`),
            permanent: true,
          })),
        );
      }
      let stoppedForDeadLetter = result.dead > 0;

      const projectedSources = new Map<string, Record<string, unknown>>();
      projections: for (const entity of FTS_SEARCH_DOCUMENT_ENTITIES) {
        if (stoppedForDeadLetter) break;
        const entityWorks = works.filter((work) => work.entity === entity);
        for (const projectionWorks of chunks(entityWorks, this.options.projectionBatchSize)) {
          let documents: Awaited<ReturnType<FtsSearchDocumentBuilder['buildByIds']>>;
          try {
            documents = await this.builder.buildByIds(
              entity,
              projectionWorks.map((work) => work.documentId),
            );
          } catch (error) {
            await fail(projectionWorks.map((work) => ({ ...work, error })));
            if (result.dead > 0) {
              stoppedForDeadLetter = true;
              break projections;
            }
            continue;
          }
          for (const document of documents) {
            projectedSources.set(
              sourceKey(entity, document.id),
              document.source as Record<string, unknown>,
            );
          }
        }
      }

      let exhaustedBulkBudget = false;
      operations: for (const work of works) {
        if (stoppedForDeadLetter) break;
        if (!unsettled.has(workKey(work))) continue;
        /** Soft tombstones prevent delayed external-version writes from resurrecting deletions. */
        const source =
          projectedSources.get(sourceKey(work.entity, work.documentId)) ??
          ({ id: work.documentId, fts_search_sync_deleted: true } as Record<string, unknown>);
        const operation = buildOperation(work, this.indexNamespace, source);

        if (operation.bytes > this.options.bulkMaxBytes) {
          await fail([
            {
              ...work,
              error: new Error(
                `Full-text search document is ${operation.bytes} bytes and exceeds the ${this.options.bulkMaxBytes}-byte bulk limit`,
              ),
              permanent: true,
            },
          ]);
          if (result.dead > 0) {
            stoppedForDeadLetter = true;
            break operations;
          }
          continue;
        }

        if (bulk.length > 0 && bulkBytes + operation.bytes > this.options.bulkMaxBytes) {
          await flush();
          if (result.dead > 0) {
            stoppedForDeadLetter = true;
            break operations;
          }
          if (result.bulkRequests >= this.options.maxBulkRequests) {
            exhaustedBulkBudget = true;
            break operations;
          }
        }

        bulk.push(operation);
        bulkBytes += operation.bytes;
      }

      if (!exhaustedBulkBudget && !stoppedForDeadLetter && bulk.length > 0) await flush();
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      const released = [...unsettled.values()];
      try {
        await this.outbox.releaseMany(released);
        result.released = released.length;
      } catch (error) {
        console.error('Failed to release unsettled full-text search sync leases', error);
        if (!hasPrimaryError) {
          hasReleaseError = true;
          releaseError = error;
        }
      }
    }

    if (hasReleaseError) throw releaseError;
    result.hasMore = await this.outbox.hasActionableWork();
    return result;
  }
}

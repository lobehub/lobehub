import { Buffer } from 'node:buffer';

import type { SearchDocumentBuilder } from '@/database/repositories/searchDocument';
import {
  getSearchIndexAlias,
  SEARCH_DOCUMENT_ENTITIES,
} from '@/database/repositories/searchDocument';
import type {
  SearchSyncFailure,
  SearchSyncOutboxRepository,
  SearchSyncWork,
} from '@/database/repositories/searchSyncOutbox';

import type { ElasticsearchBulkResponse } from '../searchBackend/elasticsearch';

export const SEARCH_SYNC_BULK_MAX_BYTES = 50 * 1024 * 1024;
export const SEARCH_SYNC_CLAIM_LIMIT = 100;
export const SEARCH_SYNC_MAX_BULK_REQUESTS = 2;
export const SEARCH_SYNC_PROJECTION_BATCH_SIZE = SEARCH_SYNC_CLAIM_LIMIT;

interface SearchSyncElasticsearchClient {
  bulk: (body: string) => Promise<ElasticsearchBulkResponse>;
}

interface SearchSyncOperation {
  body: string;
  bytes: number;
  work: SearchSyncWork;
}

interface SearchSyncServiceOptions {
  bulkMaxBytes: number;
  claimLimit: number;
  maxBulkRequests: number;
  projectionBatchSize: number;
}

export interface SearchSyncDrainResult {
  acknowledged: number;
  bulkBytes: number;
  bulkItems: number;
  bulkRequests: number;
  bulkRequestSamples: SearchSyncBulkRequestSample[];
  claimed: number;
  dead: number;
  failed: number;
  hasMore: boolean;
  released: number;
}

export interface SearchSyncBulkRequestSample {
  bytes: number;
  durationMs: number;
  items: number;
  result: 'item_error' | 'mixed' | 'request_error' | 'response_error' | 'success';
}

const workKey = (work: SearchSyncWork) => `${work.entity}:${work.documentId}:${work.revision}`;
const sourceKey = (entity: SearchSyncWork['entity'], documentId: string) =>
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
  work: SearchSyncWork,
  indexNamespace: string,
  source: Record<string, unknown>,
): SearchSyncOperation => {
  const metadata = {
    index: {
      _id: work.documentId,
      _index: getSearchIndexAlias(indexNamespace, work.entity),
      version: work.revision,
      version_type: 'external',
    },
  };
  const body = `${JSON.stringify(metadata)}\n${JSON.stringify(source)}\n`;
  return { body, bytes: Buffer.byteLength(body), work };
};

/** Bounded PostgreSQL projection → byte-aware Elasticsearch bulk drain. */
export class SearchSyncService {
  private readonly options: SearchSyncServiceOptions;

  constructor(
    private readonly builder: Pick<SearchDocumentBuilder, 'buildByIds'>,
    private readonly outbox: Pick<
      SearchSyncOutboxRepository,
      | 'acknowledgeMany'
      | 'claim'
      | 'hasActionableWork'
      | 'hasDeadLetters'
      | 'markFailures'
      | 'releaseMany'
    >,
    private readonly client: SearchSyncElasticsearchClient,
    private readonly indexNamespace: string,
    options: Partial<SearchSyncServiceOptions> = {},
  ) {
    this.options = {
      bulkMaxBytes: SEARCH_SYNC_BULK_MAX_BYTES,
      claimLimit: SEARCH_SYNC_CLAIM_LIMIT,
      maxBulkRequests: SEARCH_SYNC_MAX_BULK_REQUESTS,
      projectionBatchSize: SEARCH_SYNC_PROJECTION_BATCH_SIZE,
      ...options,
    };
  }

  async hasDeadLetters(): Promise<boolean> {
    return this.outbox.hasDeadLetters();
  }

  async drainOnce(): Promise<SearchSyncDrainResult> {
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
    const result: SearchSyncDrainResult = {
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
    let bulk: SearchSyncOperation[] = [];
    let bulkBytes = 0;

    const forget = (settledWorks: SearchSyncWork[]) => {
      for (const work of settledWorks) unsettled.delete(workKey(work));
    };

    const fail = async (failures: SearchSyncFailure[]) => {
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

      let response: ElasticsearchBulkResponse;
      const startedAt = Date.now();
      try {
        response = await this.client.bulk(requestBody);
      } catch (error) {
        result.bulkRequestSamples.push({
          bytes: requestBytes,
          durationMs: Date.now() - startedAt,
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

      const acknowledged: SearchSyncWork[] = [];
      const failures: SearchSyncFailure[] = [];
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

      result.bulkRequestSamples.push({
        bytes: requestBytes,
        durationMs: Date.now() - startedAt,
        items: operations.length,
        result:
          failures.length === 0 ? 'success' : acknowledged.length === 0 ? 'item_error' : 'mixed',
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
      const supportedEntities = new Set<string>(SEARCH_DOCUMENT_ENTITIES);
      const unsupportedWorks = works.filter((work) => !supportedEntities.has(work.entity));
      if (unsupportedWorks.length > 0) {
        await fail(
          unsupportedWorks.map((work) => ({
            ...work,
            error: new Error(`Unsupported search sync entity: ${work.entity}`),
            permanent: true,
          })),
        );
      }
      let stoppedForDeadLetter = result.dead > 0;

      const projectedSources = new Map<string, Record<string, unknown>>();
      projections: for (const entity of SEARCH_DOCUMENT_ENTITIES) {
        if (stoppedForDeadLetter) break;
        const entityWorks = works.filter((work) => work.entity === entity);
        for (const projectionWorks of chunks(entityWorks, this.options.projectionBatchSize)) {
          let documents: Awaited<ReturnType<SearchDocumentBuilder['buildByIds']>>;
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
          ({ id: work.documentId, search_sync_deleted: true } as Record<string, unknown>);
        const operation = buildOperation(work, this.indexNamespace, source);

        if (operation.bytes > this.options.bulkMaxBytes) {
          await fail([
            {
              ...work,
              error: new Error(
                `Search document is ${operation.bytes} bytes and exceeds the ${this.options.bulkMaxBytes}-byte bulk limit`,
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
        console.error('Failed to release unsettled search sync leases', error);
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

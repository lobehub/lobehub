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

import type {
  ElasticsearchFtsSearchBulkItem,
  ElasticsearchFtsSearchBulkResponse,
  ElasticsearchFtsSearchSyncIndexFieldsResult,
} from '../ftsSearch/elasticsearch';

export const FTS_SEARCH_SYNC_BULK_MAX_BYTES = 50 * 1024 * 1024;
export const FTS_SEARCH_SYNC_CLAIM_LIMIT = 100;
export const FTS_SEARCH_SYNC_MAX_BULK_REQUESTS = 2;
export const FTS_SEARCH_SYNC_PROJECTION_BATCH_SIZE = FTS_SEARCH_SYNC_CLAIM_LIMIT;

interface FtsSearchSyncElasticsearchClient {
  bulk: (body: string) => Promise<ElasticsearchFtsSearchBulkResponse>;
  /** Live physical generations per alias; every change is written to all of them. */
  getFtsSearchSyncGenerationTargets: (aliases: string[]) => Promise<Record<string, string[]>>;
  /** Validated top-level fields per physical index, used to prune documents per generation. */
  getFtsSearchSyncIndexFields: (
    entitiesByIndex: Record<string, FtsSearchSyncWork['entity']>,
  ) => Promise<ElasticsearchFtsSearchSyncIndexFieldsResult>;
}

/** One bulk action for one live generation of an Outbox change. */
interface FtsSearchSyncOperation {
  body: string;
  bytes: number;
  /** Number of Elasticsearch bulk items in this action. */
  items: number;
  work: FtsSearchSyncWork;
}

interface FtsSearchSyncServiceOptions {
  bulkMaxBytes: number;
  claimLimit: number;
  /** Soft drain budget checked between works; a started multi-generation work is always finished. */
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

const buildOperations = (
  work: FtsSearchSyncWork,
  targets: string[],
  source: Record<string, unknown>,
  fieldsByIndex: ReadonlyMap<string, ReadonlySet<string>>,
): FtsSearchSyncOperation[] => {
  /**
   * The same revision goes to every generation with `version_type: external`, so a generation that
   * a concurrent rebuild already filled with a newer revision answers 409 and is settled as done.
   * Each generation only receives the fields it maps: the document is projected by the deployed
   * code, which may already declare fields an older generation lacks, and every generation is
   * `dynamic: strict`.
   */
  return targets.map((target) => {
    const fields = fieldsByIndex.get(target);
    const projected = fields
      ? Object.fromEntries(Object.entries(source).filter(([field]) => fields.has(field)))
      : source;
    const metadata = {
      index: {
        _id: work.documentId,
        _index: target,
        version: work.revision,
        version_type: 'external',
      },
    };
    const body = `${JSON.stringify(metadata)}\n${JSON.stringify(projected)}\n`;
    return { body, bytes: Buffer.byteLength(body), items: 1, work };
  });
};

const isAcceptedBulkItem = ({ index: item }: ElasticsearchFtsSearchBulkItem) =>
  (item.status >= 200 && item.status < 300) || item.status === 409;

/** A generation retired between target resolution and the write; the next drain re-resolves. */
const isRetiredGenerationBulkItem = ({ index: item }: ElasticsearchFtsSearchBulkItem) =>
  item.error?.type === 'index_not_found_exception' || item.error?.type === 'index_closed_exception';

interface ElasticsearchBulkFailureSummary {
  status: number;
  type: string;
}

/** Retains only the bounded Elasticsearch error type; reasons may contain document source data. */
const summarizeElasticsearchBulkFailure = ({
  error,
  status,
}: ElasticsearchFtsSearchBulkItem['index']): ElasticsearchBulkFailureSummary => ({
  status,
  type: error?.type?.slice(0, 128) ?? 'unknown',
});

const describeElasticsearchBulkFailure = ({ status, type }: ElasticsearchBulkFailureSummary) =>
  new Error(`Elasticsearch bulk item failed (${status}, type=${type})`);

const summarizeBulkEntities = (
  operations: FtsSearchSyncOperation[],
  result: FtsSearchSyncBulkRequestResult,
  failedWorkKeys?: Set<string>,
): FtsSearchSyncBulkRequestSample['entities'] => {
  const summaries = new Map<
    FtsSearchSyncWork['entity'],
    { actions: number; bytes: number; failed: number; items: number }
  >();

  for (const operation of operations) {
    const entity = operation.work.entity;
    const current = summaries.get(entity) ?? { actions: 0, bytes: 0, failed: 0, items: 0 };
    current.bytes += operation.bytes;
    current.items += operation.items;
    current.actions += 1;
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
          : summary.failed === summary.actions
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
    const workProgress = new Map<
      string,
      { accepted: number; remaining: number; retiredFailures: ElasticsearchBulkFailureSummary[] }
    >();

    const forget = (settledWorks: FtsSearchSyncWork[]) => {
      for (const work of settledWorks) unsettled.delete(workKey(work));
    };

    const fail = async (failures: FtsSearchSyncFailure[]) => {
      result.dead += await this.outbox.markFailures(failures);
      result.failed += failures.length;
      forget(failures);
      for (const failure of failures) workProgress.delete(workKey(failure));
    };

    const flush = async () => {
      if (bulk.length === 0) return;
      const operations = bulk;
      const requestBody = operations.map((operation) => operation.body).join('');
      const requestBytes = bulkBytes;
      const requestItems = operations.reduce((total, operation) => total + operation.items, 0);
      bulk = [];
      bulkBytes = 0;
      result.bulkBytes += requestBytes;
      result.bulkItems += requestItems;
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
          items: requestItems,
          result: 'request_error',
        });
        /** Request-level failures can be deployment or proxy faults; retry every item durably. */
        await fail(
          [...new Map(operations.map(({ work }) => [workKey(work), work])).values()].map(
            (work) => ({ ...work, error }),
          ),
        );
        return;
      }

      if (response.items.length !== requestItems) {
        result.bulkRequestSamples.push({
          bytes: requestBytes,
          durationMs: Date.now() - startedAt,
          entities: summarizeBulkEntities(operations, 'response_error'),
          items: requestItems,
          result: 'response_error',
        });
        await fail(
          [...new Map(operations.map(({ work }) => [workKey(work), work])).values()].map(
            (work) => ({
              ...work,
              error: new Error(
                `Elasticsearch bulk returned ${response.items.length} items for ${requestItems} operations`,
              ),
            }),
          ),
        );
        return;
      }

      const acknowledged: FtsSearchSyncWork[] = [];
      const failures: FtsSearchSyncFailure[] = [];
      const itemsByWork = new Map<
        string,
        { items: ElasticsearchFtsSearchBulkItem[]; work: FtsSearchSyncWork }
      >();
      let offset = 0;
      for (const operation of operations) {
        const items = response.items.slice(offset, offset + operation.items);
        offset += operation.items;
        const key = workKey(operation.work);
        const current = itemsByWork.get(key) ?? { items: [], work: operation.work };
        current.items.push(...items);
        itemsByWork.set(key, current);
      }

      for (const [key, { items, work }] of itemsByWork) {
        /**
         * A version conflict is safe to settle because two database fences preserve source order:
         * fresh reindexes reserve their base revision before capture activation, and same-document
         * Outbox upserts allocate a revision only after locking the unique Outbox row. Settlement
         * is also revision-and-lease fenced, so a concurrent refresh remains queued.
         */
        const accepted = items.filter(isAcceptedBulkItem).length;
        const rejected = items.filter(
          (item) => !isAcceptedBulkItem(item) && !isRetiredGenerationBulkItem(item),
        );
        if (rejected.length > 0) {
          const failedItem = rejected[0].index;
          failures.push({
            ...work,
            error: describeElasticsearchBulkFailure(summarizeElasticsearchBulkFailure(failedItem)),
            permanent: isPermanentElasticsearchStatus(failedItem.status),
          });
          continue;
        }

        const progress = workProgress.get(key)!;
        progress.accepted += accepted;
        progress.remaining -= items.length;
        progress.retiredFailures.push(
          ...items
            .filter(isRetiredGenerationBulkItem)
            .map(({ index }) => summarizeElasticsearchBulkFailure(index)),
        );
        if (progress.remaining > 0) continue;

        /**
         * A change is done once every generation that still exists holds it. Retired generations
         * are ignored only when another generation accepted the write; if none did, the alias
         * itself is gone and the change must not be lost.
         */
        if (progress.accepted > 0) {
          acknowledged.push(work);
          workProgress.delete(key);
          continue;
        }
        const failedItem = progress.retiredFailures[0];
        failures.push({
          ...work,
          error: describeElasticsearchBulkFailure(failedItem),
          permanent: isPermanentElasticsearchStatus(failedItem.status),
        });
      }

      const bulkResult =
        failures.length === 0
          ? 'success'
          : failures.length === itemsByWork.size
            ? 'item_error'
            : 'mixed';
      result.bulkRequestSamples.push({
        bytes: requestBytes,
        durationMs: Date.now() - startedAt,
        entities: summarizeBulkEntities(operations, bulkResult, new Set(failures.map(workKey))),
        items: requestItems,
        result: bulkResult,
      });

      if (acknowledged.length > 0) {
        const deleted = await this.outbox.acknowledgeMany(acknowledged);
        result.acknowledged += deleted.length;
        forget(acknowledged);
      }
      if (failures.length > 0) await fail(failures);
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

      /**
       * Resolve the live generations of every entity in this batch once per drain. Resolution
       * failures are retried durably like a failed bulk request: the alias table is an
       * Elasticsearch read that can fail for the same transient reasons.
       */
      const targetsByEntity = new Map<FtsSearchSyncWork['entity'], string[]>();
      const fieldsByIndex = new Map<string, ReadonlySet<string>>();
      const pendingEntities = [
        ...new Set(works.filter((work) => unsettled.has(workKey(work))).map((work) => work.entity)),
      ];
      if (!stoppedForDeadLetter && pendingEntities.length > 0) {
        const aliasEntities = new Map(
          pendingEntities.map(
            (entity) => [getFtsSearchIndexAlias(this.indexNamespace, entity), entity] as const,
          ),
        );
        try {
          const targets = await this.client.getFtsSearchSyncGenerationTargets([
            ...aliasEntities.keys(),
          ]);
          for (const [alias, entity] of aliasEntities) {
            const entityTargets = targets[alias];
            if (!entityTargets || entityTargets.length === 0) {
              throw new Error(`Elasticsearch returned no generation targets for alias ${alias}`);
            }
            targetsByEntity.set(entity, entityTargets);
          }
          const entitiesByIndex: Record<string, FtsSearchSyncWork['entity']> = {};
          for (const [entity, indexes] of targetsByEntity) {
            for (const index of indexes) entitiesByIndex[index] = entity;
          }
          const indexes = Object.keys(entitiesByIndex).sort();
          const { fieldsByIndex: resolvedFieldsByIndex, incompatibilities } =
            await this.client.getFtsSearchSyncIndexFields(entitiesByIndex);
          const incompatibilityMessagesByEntity = new Map<FtsSearchSyncWork['entity'], string[]>();
          for (const incompatibility of incompatibilities) {
            const messages = incompatibilityMessagesByEntity.get(incompatibility.entity) ?? [];
            messages.push(incompatibility.message);
            incompatibilityMessagesByEntity.set(incompatibility.entity, messages);
          }
          if (incompatibilityMessagesByEntity.size > 0) {
            await fail(
              works
                .filter(
                  (work) =>
                    unsettled.has(workKey(work)) &&
                    incompatibilityMessagesByEntity.has(work.entity),
                )
                .map((work) => ({
                  ...work,
                  error: new Error(incompatibilityMessagesByEntity.get(work.entity)!.join(' ')),
                  permanent: true,
                })),
            );
          }
          for (const index of indexes) {
            if (!resolvedFieldsByIndex[index]) {
              throw new Error(`Elasticsearch returned no mapped fields for index ${index}`);
            }
            fieldsByIndex.set(index, new Set(resolvedFieldsByIndex[index]));
          }
        } catch (error) {
          await fail(
            works
              .filter((work) => unsettled.has(workKey(work)))
              .map((work) => ({ ...work, error })),
          );
          if (result.dead > 0) stoppedForDeadLetter = true;
        }
      }

      let exhaustedBulkBudget = false;
      workLoop: for (const work of works) {
        if (stoppedForDeadLetter) break;
        if (!unsettled.has(workKey(work))) continue;
        if (result.bulkRequests >= this.options.maxBulkRequests) {
          /** Flush the tail of the previous started work, then stop before beginning another. */
          await flush();
          if (result.dead > 0) stoppedForDeadLetter = true;
          exhaustedBulkBudget = true;
          break workLoop;
        }
        /** Soft tombstones prevent delayed external-version writes from resurrecting deletions. */
        const source =
          projectedSources.get(sourceKey(work.entity, work.documentId)) ??
          ({ id: work.documentId, fts_search_sync_deleted: true } as Record<string, unknown>);
        const operations = buildOperations(
          work,
          targetsByEntity.get(work.entity)!,
          source,
          fieldsByIndex,
        );

        const oversizedOperation = operations.find(
          (operation) => operation.bytes > this.options.bulkMaxBytes,
        );
        if (oversizedOperation) {
          await fail([
            {
              ...work,
              error: new Error(
                `Full-text search document generation is ${oversizedOperation.bytes} bytes and exceeds the ${this.options.bulkMaxBytes}-byte bulk limit`,
              ),
              permanent: true,
            },
          ]);
          if (result.dead > 0) {
            stoppedForDeadLetter = true;
            break workLoop;
          }
          continue;
        }

        const progress = {
          accepted: 0,
          remaining: operations.length,
          retiredFailures: [],
        };
        workProgress.set(workKey(work), progress);
        for (const operation of operations) {
          if (bulk.length > 0 && bulkBytes + operation.bytes > this.options.bulkMaxBytes) {
            const deadBeforeFlush = result.dead;
            await flush();
            if (result.dead > deadBeforeFlush) {
              stoppedForDeadLetter = true;
              break workLoop;
            }
            if (!unsettled.has(workKey(work))) break;
            /** Finish an already-started work even when it spans more requests than the budget. */
            if (
              result.bulkRequests >= this.options.maxBulkRequests &&
              progress.remaining === operations.length
            ) {
              exhaustedBulkBudget = true;
              break workLoop;
            }
          }

          bulk.push(operation);
          bulkBytes += operation.bytes;
        }
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

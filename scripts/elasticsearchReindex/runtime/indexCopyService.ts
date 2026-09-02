import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  getFtsSearchIndexAlias,
  getFtsSearchIndexMappings,
  getFtsSearchPhysicalIndexName,
} from '../../../packages/database/src/repositories/ftsSearchDocument';
import type {
  FtsSearchReindexAliasTarget,
  FtsSearchReindexIndexBody,
  FtsSearchReindexIndexOptions,
} from './reindexService';
import { assertAliasSwitchCoversAllEntities } from './reindexService';

/** Subset of the reindex transport needed to copy one schema version into the next inside Elasticsearch. */
export interface FtsSearchIndexCopyElasticsearchClient {
  count: (index: string) => Promise<number>;
  ensureIndex: (
    index: string,
    body: FtsSearchReindexIndexBody,
    options?: FtsSearchReindexIndexOptions,
  ) => Promise<void>;
  getTask: (taskId: string) => Promise<FtsSearchIndexCopyTaskStatus>;
  refresh: (index: string) => Promise<void>;
  startReindex: (source: string, destination: string) => Promise<string>;
  switchAliases: (targets: FtsSearchReindexAliasTarget[]) => Promise<void>;
}

export interface FtsSearchIndexCopyTaskStatus {
  /** Cancellation reason when Elasticsearch stopped the task early. */
  canceled?: string;
  completed: boolean;
  created: number;
  deleted: number;
  /** Reindex item failures reported by Elasticsearch once the task completes. */
  failures: unknown[];
  noops: number;
  total: number;
  updated: number;
  versionConflicts: number;
}

export type FtsSearchIndexCopyProgressEvent =
  | { entity: FtsSearchDocumentEntity; taskId: string; type: 'copy_started' }
  | {
      created: number;
      entity: FtsSearchDocumentEntity;
      sourceCount: number;
      targetCount: number;
      type: 'copy_completed';
      updated: number;
      versionConflicts: number;
    }
  | { type: 'aliases_switched' };

export interface FtsSearchIndexCopyOptions {
  /**
   * Called immediately before the alias switch, not at command start, so a consumer that is
   * still draining the Outbox when the copy finishes hours later is caught at the moment it matters.
   */
  assertAliasSwitchAllowed: () => Promise<void> | void;
  entities: FtsSearchDocumentEntity[];
  entityConcurrency: number;
  onProgress: (event: FtsSearchIndexCopyProgressEvent) => Promise<void> | void;
  pollIntervalMs: number;
  switchAliases: boolean;
}

export interface FtsSearchIndexCopyResult {
  aliasesSwitched: boolean;
  entities: Record<
    string,
    { sourceCount: number; targetCount: number; updated: number; versionConflicts: number }
  >;
}

export class FtsSearchIndexCopyError extends Error {
  constructor(
    readonly entity: FtsSearchDocumentEntity,
    cause: unknown,
  ) {
    super(`Elasticsearch index copy failed for ${entity}`, { cause });
    this.name = 'FtsSearchIndexCopyError';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const mapWithConcurrency = async <Item, Result>(
  items: Item[],
  concurrency: number,
  worker: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results: Result[] = Array.from({ length: items.length });
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

/**
 * Copies every entity index from one schema version to the next with the Elasticsearch `_reindex`
 * API instead of rescanning PostgreSQL. Document versions are carried over with `external`
 * versioning, so the copy can run twice: once while incremental sync keeps writing to the old
 * aliases, and a short second pass (with the consumer paused) that only touches documents whose
 * version moved in between; unchanged documents are skipped as version conflicts.
 *
 * Only usable while the source schema still stores every mapped field in `_source`.
 */
export class FtsSearchIndexCopyService {
  private readonly options: FtsSearchIndexCopyOptions;

  constructor(
    private readonly client: FtsSearchIndexCopyElasticsearchClient,
    options: Partial<FtsSearchIndexCopyOptions> = {},
  ) {
    this.options = {
      assertAliasSwitchAllowed: options.assertAliasSwitchAllowed ?? (() => {}),
      entities: options.entities ? [...options.entities] : [...FTS_SEARCH_DOCUMENT_ENTITIES],
      entityConcurrency: options.entityConcurrency ?? 2,
      onProgress: options.onProgress ?? (() => {}),
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      switchAliases: options.switchAliases ?? false,
    };
    assertAliasSwitchCoversAllEntities(this.options.switchAliases, this.options.entities);
  }

  async run(
    namespace: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<FtsSearchIndexCopyResult> {
    if (
      !Number.isInteger(fromVersion) ||
      !Number.isInteger(toVersion) ||
      fromVersion >= toVersion
    ) {
      throw new Error('Index copy requires an older source schema version than the target');
    }
    /**
     * Deterministic run identity lets the second pass resume into the indices the first pass
     * created; `ensureIndex` still rejects a target created by an unrelated run or schema.
     */
    const runId = `copy-v${fromVersion}-v${toVersion}`;
    const result: FtsSearchIndexCopyResult = { aliasesSwitched: false, entities: {} };

    await mapWithConcurrency(
      this.options.entities,
      this.options.entityConcurrency,
      async (entity) => {
        try {
          result.entities[entity] = await this.copyEntity(namespace, entity, runId, {
            fromVersion,
            toVersion,
          });
        } catch (error) {
          throw new FtsSearchIndexCopyError(entity, error);
        }
      },
    );

    if (!this.options.switchAliases) return result;

    await this.options.assertAliasSwitchAllowed();
    await this.client.switchAliases(
      this.options.entities.map((entity) => ({
        alias: getFtsSearchIndexAlias(namespace, entity),
        physicalIndex: getFtsSearchPhysicalIndexName(namespace, entity, toVersion),
      })),
    );
    result.aliasesSwitched = true;
    await this.options.onProgress({ type: 'aliases_switched' });
    return result;
  }

  private async copyEntity(
    namespace: string,
    entity: FtsSearchDocumentEntity,
    runId: string,
    { fromVersion, toVersion }: { fromVersion: number; toVersion: number },
  ) {
    const source = getFtsSearchPhysicalIndexName(namespace, entity, fromVersion);
    const target = getFtsSearchPhysicalIndexName(namespace, entity, toVersion);

    await this.client.ensureIndex(target, {
      mappings: {
        ...getFtsSearchIndexMappings(entity),
        _meta: { reindex_run_id: runId, schema_version: toVersion },
      },
      settings: { analysis: FTS_SEARCH_INDEX_ANALYSIS },
    });

    const taskId = await this.client.startReindex(source, target);
    await this.options.onProgress({ entity, taskId, type: 'copy_started' });

    let status = await this.client.getTask(taskId);
    while (!status.completed) {
      await sleep(this.options.pollIntervalMs);
      status = await this.client.getTask(taskId);
    }
    if (status.failures.length > 0) {
      throw new Error(
        `Elasticsearch reindex task ${taskId} reported ${status.failures.length} failures: ${JSON.stringify(status.failures.slice(0, 3))}`,
      );
    }
    /**
     * A canceled task completes without item failures but leaves the target partial. Every source
     * document must be accounted for as created, updated, skipped by version, no-op, or deleted
     * before the target is trusted for an alias switch.
     */
    if (status.canceled) {
      throw new Error(`Elasticsearch reindex task ${taskId} was canceled: ${status.canceled}`);
    }
    const accounted =
      status.created + status.updated + status.versionConflicts + status.noops + status.deleted;
    if (accounted !== status.total) {
      throw new Error(
        `Elasticsearch reindex task ${taskId} processed ${accounted} of ${status.total} documents`,
      );
    }

    await this.client.refresh(target);
    const [sourceCount, targetCount] = await Promise.all([
      this.client.count(source),
      this.client.count(target),
    ]);
    await this.options.onProgress({
      created: status.created,
      entity,
      sourceCount,
      targetCount,
      type: 'copy_completed',
      updated: status.updated,
      versionConflicts: status.versionConflicts,
    });
    return {
      sourceCount,
      targetCount,
      updated: status.updated,
      versionConflicts: status.versionConflicts,
    };
  }
}

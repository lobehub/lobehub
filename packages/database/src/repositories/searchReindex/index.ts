import type { SearchDocumentEntity } from '@lobechat/types';
import { SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  searchReindexEntityProgress,
  searchReindexFailures,
  searchReindexRuns,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { getSearchPhysicalIndexName } from '../searchDocument';

export interface SearchReindexBatchFailure {
  documentId: string;
  error: unknown;
  retryable: boolean;
}

export interface SearchReindexBatchCheckpoint {
  cursor: string;
  entity: SearchDocumentEntity;
  failures: SearchReindexBatchFailure[];
  indexedCount: number;
  previousCursor: string | null;
  processedCount: number;
  runId: string;
}

export interface SearchReindexRunState {
  progress: (typeof searchReindexEntityProgress.$inferSelect)[];
  run: typeof searchReindexRuns.$inferSelect;
}

const activeRunStatuses = ['backfilling', 'ready_for_incremental_sync'] as const;

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 4000);

/** Durable control-plane state for resumable PostgreSQL to Elasticsearch reindex runs. */
export class SearchReindexRepository {
  constructor(private readonly db: LobeChatDatabase) {}

  async checkpointBatch({
    cursor,
    entity,
    failures,
    indexedCount,
    previousCursor,
    processedCount,
    runId,
  }: SearchReindexBatchCheckpoint): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const updated = await transaction
        .update(searchReindexEntityProgress)
        .set({
          cursor,
          indexedCount: sql`${searchReindexEntityProgress.indexedCount} + ${indexedCount}`,
          processedCount: sql`${searchReindexEntityProgress.processedCount} + ${processedCount}`,
          status: 'backfilling',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(searchReindexEntityProgress.runId, runId),
            eq(searchReindexEntityProgress.entity, entity),
            previousCursor === null
              ? isNull(searchReindexEntityProgress.cursor)
              : eq(searchReindexEntityProgress.cursor, previousCursor),
          ),
        )
        .returning({ id: searchReindexEntityProgress.id });
      if (updated.length !== 1) return false;

      if (failures.length > 0) {
        await transaction
          .insert(searchReindexFailures)
          .values(
            failures.map((failure) => ({
              documentId: failure.documentId,
              entity,
              error: errorMessage(failure.error),
              retryable: failure.retryable,
              runId,
            })),
          )
          .onConflictDoUpdate({
            set: {
              attempts: sql`${searchReindexFailures.attempts} + 1`,
              error: sql`excluded.error`,
              resolvedAt: null,
              retryable: sql`excluded.retryable`,
              updatedAt: new Date(),
            },
            target: [
              searchReindexFailures.runId,
              searchReindexFailures.entity,
              searchReindexFailures.documentId,
            ],
          });
      }

      await transaction
        .update(searchReindexEntityProgress)
        .set({
          failedCount: sql`(
            SELECT COUNT(*)::int
            FROM ${searchReindexFailures}
            WHERE ${searchReindexFailures.runId} = ${runId}
              AND ${searchReindexFailures.entity} = ${entity}
              AND ${searchReindexFailures.resolvedAt} IS NULL
          )`,
          updatedAt: new Date(),
        })
        .where(eq(searchReindexEntityProgress.id, updated[0].id));
      return true;
    });
  }

  async completeEntity(runId: string, entity: SearchDocumentEntity): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [unresolved] = await transaction
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(searchReindexFailures)
        .where(
          and(
            eq(searchReindexFailures.runId, runId),
            eq(searchReindexFailures.entity, entity),
            isNull(searchReindexFailures.resolvedAt),
          ),
        );
      if ((unresolved?.count ?? 0) > 0) {
        throw new Error(`Cannot complete ${entity}: ${unresolved.count} reindex failures remain`);
      }

      await transaction
        .update(searchReindexEntityProgress)
        .set({
          completedAt: new Date(),
          failedCount: 0,
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(searchReindexEntityProgress.runId, runId),
            eq(searchReindexEntityProgress.entity, entity),
          ),
        );
    });
  }

  async createOrResume(namespace: string, schemaVersion: number): Promise<SearchReindexRunState> {
    return this.db.transaction(async (transaction) => {
      /** Serialize operators without storing deployment credentials or relying on process locks. */
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${namespace}))`);

      const [existing] = await transaction
        .select()
        .from(searchReindexRuns)
        .where(
          and(
            eq(searchReindexRuns.namespace, namespace),
            eq(searchReindexRuns.schemaVersion, schemaVersion),
            inArray(searchReindexRuns.status, activeRunStatuses),
          ),
        )
        .orderBy(desc(searchReindexRuns.createdAt))
        .limit(1);
      if (existing) {
        const progress = await transaction
          .select()
          .from(searchReindexEntityProgress)
          .where(eq(searchReindexEntityProgress.runId, existing.id));
        return { progress, run: existing };
      }

      const revisionResult = await transaction.execute<{ revision: number | string }>(
        sql`SELECT nextval('search_sync_revision_seq')::bigint AS revision`,
      );
      const revisionRows = Array.isArray(revisionResult) ? revisionResult : revisionResult.rows;
      const baseRevision = Number(revisionRows[0]?.revision);
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) {
        throw new Error('Failed to reserve a valid search reindex base revision');
      }

      const [run] = await transaction
        .insert(searchReindexRuns)
        .values({ baseRevision, namespace, schemaVersion })
        .returning();
      const progress = await transaction
        .insert(searchReindexEntityProgress)
        .values(
          SEARCH_DOCUMENT_ENTITIES.map((entity) => ({
            entity,
            physicalIndex: getSearchPhysicalIndexName(namespace, entity, schemaVersion),
            runId: run.id,
          })),
        )
        .returning();

      return { progress, run };
    });
  }

  async getRun(runId: string): Promise<SearchReindexRunState | undefined> {
    const [run] = await this.db
      .select()
      .from(searchReindexRuns)
      .where(eq(searchReindexRuns.id, runId))
      .limit(1);
    if (!run) return;

    const progress = await this.db
      .select()
      .from(searchReindexEntityProgress)
      .where(eq(searchReindexEntityProgress.runId, runId));
    return { progress, run };
  }

  async getLatestRun(namespace: string): Promise<SearchReindexRunState | undefined> {
    const [run] = await this.db
      .select()
      .from(searchReindexRuns)
      .where(eq(searchReindexRuns.namespace, namespace))
      .orderBy(desc(searchReindexRuns.createdAt))
      .limit(1);
    if (!run) return;
    return this.getRun(run.id);
  }

  async listUnresolvedFailures(runId: string, entity?: SearchDocumentEntity) {
    return this.db
      .select()
      .from(searchReindexFailures)
      .where(
        and(
          eq(searchReindexFailures.runId, runId),
          isNull(searchReindexFailures.resolvedAt),
          entity ? eq(searchReindexFailures.entity, entity) : undefined,
        ),
      );
  }

  async markReadyForIncrementalSync(runId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const incomplete = await transaction
        .select({ entity: searchReindexEntityProgress.entity })
        .from(searchReindexEntityProgress)
        .where(
          and(
            eq(searchReindexEntityProgress.runId, runId),
            inArray(searchReindexEntityProgress.status, ['pending', 'backfilling']),
          ),
        )
        .limit(1);
      const unresolved = await transaction
        .select({ id: searchReindexFailures.id })
        .from(searchReindexFailures)
        .where(
          and(eq(searchReindexFailures.runId, runId), isNull(searchReindexFailures.resolvedAt)),
        )
        .limit(1);
      if (incomplete.length > 0 || unresolved.length > 0) {
        throw new Error(
          'Cannot create aliases before every reindex entity and failure is complete',
        );
      }

      const revisionResult = await transaction.execute<{
        high_water_revision: number | string;
      }>(sql`
        SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS high_water_revision
        FROM search_sync_revision_seq
      `);
      const revisionRows = Array.isArray(revisionResult) ? revisionResult : revisionResult.rows;
      const backfillHighWaterRevision = Number(revisionRows[0]?.high_water_revision ?? 0);

      await transaction
        .update(searchReindexRuns)
        .set({
          aliasesCreatedAt: new Date(),
          backfillHighWaterRevision,
          status: 'ready_for_incremental_sync',
          updatedAt: new Date(),
        })
        .where(eq(searchReindexRuns.id, runId));
    });
  }

  async resolveFailures(
    runId: string,
    entity: SearchDocumentEntity,
    documentIds: string[],
  ): Promise<number> {
    if (documentIds.length === 0) return 0;

    return this.db.transaction(async (transaction) => {
      const resolved = await transaction
        .update(searchReindexFailures)
        .set({ resolvedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(searchReindexFailures.runId, runId),
            eq(searchReindexFailures.entity, entity),
            inArray(searchReindexFailures.documentId, documentIds),
            isNull(searchReindexFailures.resolvedAt),
          ),
        )
        .returning({ id: searchReindexFailures.id });

      await transaction
        .update(searchReindexEntityProgress)
        .set({
          failedCount: sql`(
            SELECT COUNT(*)::int
            FROM ${searchReindexFailures}
            WHERE ${searchReindexFailures.runId} = ${runId}
              AND ${searchReindexFailures.entity} = ${entity}
              AND ${searchReindexFailures.resolvedAt} IS NULL
          )`,
          indexedCount: sql`${searchReindexEntityProgress.indexedCount} + ${resolved.length}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(searchReindexEntityProgress.runId, runId),
            eq(searchReindexEntityProgress.entity, entity),
          ),
        );

      return resolved.length;
    });
  }

  /** Resolves one failure by explicit operator decision without counting it as indexed. */
  async skipFailure(
    runId: string,
    entity: SearchDocumentEntity,
    documentId: string,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const skipped = await transaction
        .update(searchReindexFailures)
        .set({
          error: sql`LEFT('Skipped by operator: ' || ${searchReindexFailures.error}, 4000)`,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(searchReindexFailures.runId, runId),
            eq(searchReindexFailures.entity, entity),
            eq(searchReindexFailures.documentId, documentId),
            isNull(searchReindexFailures.resolvedAt),
            eq(searchReindexFailures.retryable, false),
          ),
        )
        .returning({ id: searchReindexFailures.id });
      if (skipped.length !== 1) return false;

      await transaction
        .update(searchReindexEntityProgress)
        .set({
          failedCount: sql`(
            SELECT COUNT(*)::int
            FROM ${searchReindexFailures}
            WHERE ${searchReindexFailures.runId} = ${runId}
              AND ${searchReindexFailures.entity} = ${entity}
              AND ${searchReindexFailures.resolvedAt} IS NULL
          )`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(searchReindexEntityProgress.runId, runId),
            eq(searchReindexEntityProgress.entity, entity),
          ),
        );
      return true;
    });
  }
}

export type { SearchReindexHttpClientOptions } from './elasticsearch';
export { SearchReindexHttpClient, SearchReindexRequestError } from './elasticsearch';
export type {
  SearchReindexElasticsearchClient,
  SearchReindexIndexBody,
  SearchReindexProgressEvent,
  SearchReindexResult,
  SearchReindexServiceOptions,
  SearchReindexStateRepository,
} from './service';
export { SearchReindexService } from './service';

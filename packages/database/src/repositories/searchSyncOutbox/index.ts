import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../../type';
import type { SearchDocumentEntity } from '../searchDocument';
import { SEARCH_DOCUMENT_ENTITIES } from '../searchDocument';

export interface SearchSyncWork {
  documentId: string;
  entity: SearchDocumentEntity;
  revision: number;
}

export interface SearchSyncFailure extends SearchSyncWork {
  error: unknown;
  permanent?: boolean;
}

export interface SearchSyncOutboxEntityStats {
  dead: number;
  expiredLeases: number;
  inFlight: number;
  oldestReadyAgeSeconds: number;
  pending: number;
  ready: number;
  retrying: number;
}

export interface SearchSyncOutboxStats extends SearchSyncOutboxEntityStats {
  entities: Record<SearchDocumentEntity, SearchSyncOutboxEntityStats>;
  highWaterRevision: number;
  oldestActiveRevision: number | null;
  revisionLag: number;
}

/** Approximately one day of durable retries when the exponential delay is capped at one hour. */
export const SEARCH_SYNC_MAX_ATTEMPTS = 36;

type SearchSyncDatabase = Pick<LobeChatDatabase, 'execute'>;

interface SearchSyncRow {
  document_id: string;
  entity: SearchDocumentEntity;
  revision: number | string;
}

const rowsOf = <Row>(result: unknown): Row[] => {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
};

const toWork = (row: SearchSyncRow): SearchSyncWork => ({
  documentId: row.document_id,
  entity: row.entity,
  revision: Number(row.revision),
});

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2000);

/** Durable claim and settlement operations for the PostgreSQL-triggered search outbox. */
export class SearchSyncOutboxRepository {
  constructor(private readonly db: SearchSyncDatabase) {}

  /** Enables trigger capture for deployments that operate an outbox consumer. */
  async enableCapture(): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO search_sync_settings (key, enabled)
      VALUES ('default', true)
      ON CONFLICT (key) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        updated_at = now()
      WHERE search_sync_settings.enabled IS DISTINCT FROM EXCLUDED.enabled
    `);
  }

  /** Disables trigger capture without deleting already queued changes. */
  async disableCapture(): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO search_sync_settings (key, enabled)
      VALUES ('default', false)
      ON CONFLICT (key) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        updated_at = now()
      WHERE search_sync_settings.enabled IS DISTINCT FROM EXCLUDED.enabled
    `);
  }

  async isCaptureEnabled(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT COALESCE(
        (SELECT enabled FROM search_sync_settings WHERE key = 'default'),
        false
      ) AS enabled
    `);
    return Boolean(rowsOf<{ enabled: boolean }>(result)[0]?.enabled);
  }

  async acknowledgeMany(works: SearchSyncWork[]): Promise<SearchSyncWork[]> {
    if (works.length === 0) return [];

    const values = sql.join(
      works.map(
        (work) => sql`(${work.entity}::text, ${work.documentId}::text, ${work.revision}::bigint)`,
      ),
      sql`, `,
    );
    const result = await this.db.execute(sql`
      WITH acknowledged(entity, document_id, revision) AS (
        VALUES ${values}
      )
      DELETE FROM search_sync_outbox AS outbox
      USING acknowledged
      WHERE outbox.entity = acknowledged.entity
        AND outbox.document_id = acknowledged.document_id
        AND outbox.revision = acknowledged.revision
      RETURNING outbox.entity, outbox.document_id, outbox.revision
    `);

    return rowsOf<SearchSyncRow>(result).map(toWork);
  }

  async claim(limit = 100, leaseSeconds = 300): Promise<SearchSyncWork[]> {
    const result = await this.db.execute(sql`
      WITH expired AS MATERIALIZED (
        UPDATE search_sync_outbox
        SET attempts = attempts + 1,
            available_at = now() + make_interval(
              secs => GREATEST(30, LEAST(POWER(2, attempts)::double precision, 3600))
            ),
            dead_at = CASE
              WHEN attempts + 1 >= ${SEARCH_SYNC_MAX_ATTEMPTS} THEN now()
              ELSE dead_at
            END,
            last_error = 'Search sync lease expired before settlement',
            locked_until = NULL,
            updated_at = now()
        WHERE locked_until <= now()
          AND dead_at IS NULL
        RETURNING entity, document_id
      ), candidates AS (
        SELECT entity, document_id, revision
        FROM search_sync_outbox
        WHERE available_at <= now()
          AND locked_until IS NULL
          AND dead_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM expired
            WHERE expired.entity = search_sync_outbox.entity
              AND expired.document_id = search_sync_outbox.document_id
          )
        ORDER BY priority, available_at, revision
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      , claimed AS (
        UPDATE search_sync_outbox AS outbox
        SET locked_until = now() + make_interval(secs => ${leaseSeconds}),
            updated_at = now()
        FROM candidates
        WHERE outbox.entity = candidates.entity
          AND outbox.document_id = candidates.document_id
          AND outbox.revision = candidates.revision
        RETURNING outbox.entity, outbox.document_id, outbox.revision,
                  outbox.priority, outbox.available_at
      )
      SELECT entity, document_id, revision
      FROM claimed
      ORDER BY priority, available_at, revision
    `);

    return rowsOf<SearchSyncRow>(result).map(toWork);
  }

  async hasActionableWork(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM search_sync_outbox
        WHERE available_at <= now()
          AND (locked_until IS NULL OR locked_until <= now())
          AND dead_at IS NULL
        LIMIT 1
      ) AS actionable
    `);

    return Boolean(rowsOf<{ actionable: boolean }>(result)[0]?.actionable);
  }

  async markFailures(failures: SearchSyncFailure[]): Promise<number> {
    if (failures.length === 0) return 0;

    const values = sql.join(
      failures.map(
        (failure) =>
          sql`(${failure.entity}::text, ${failure.documentId}::text, ${failure.revision}::bigint, ${errorMessage(failure.error)}::text, ${failure.permanent ?? false}::boolean)`,
      ),
      sql`, `,
    );
    const result = await this.db.execute(sql`
      WITH failed(entity, document_id, revision, last_error, permanent) AS (
        VALUES ${values}
      )
      UPDATE search_sync_outbox AS outbox
      SET attempts = outbox.attempts + 1,
          available_at = CASE
            WHEN failed.permanent THEN outbox.available_at
            ELSE now() + make_interval(
              secs => GREATEST(30, LEAST(POWER(2, outbox.attempts)::double precision, 3600))
            )
          END,
          dead_at = CASE
            WHEN failed.permanent OR outbox.attempts + 1 >= ${SEARCH_SYNC_MAX_ATTEMPTS} THEN now()
            ELSE outbox.dead_at
          END,
          last_error = failed.last_error,
          locked_until = NULL,
          updated_at = now()
      FROM failed
      WHERE outbox.entity = failed.entity
        AND outbox.document_id = failed.document_id
        AND outbox.revision = failed.revision
        AND outbox.locked_until IS NOT NULL
      RETURNING outbox.dead_at IS NOT NULL AS dead
    `);

    return rowsOf<{ dead: boolean }>(result).filter((row) => row.dead).length;
  }

  async releaseMany(works: SearchSyncWork[]): Promise<void> {
    if (works.length === 0) return;

    const values = sql.join(
      works.map(
        (work) => sql`(${work.entity}::text, ${work.documentId}::text, ${work.revision}::bigint)`,
      ),
      sql`, `,
    );
    await this.db.execute(sql`
      WITH released(entity, document_id, revision) AS (
        VALUES ${values}
      )
      UPDATE search_sync_outbox AS outbox
      SET locked_until = NULL, updated_at = now()
      FROM released
      WHERE outbox.entity = released.entity
        AND outbox.document_id = released.document_id
        AND outbox.revision = released.revision
        AND outbox.locked_until IS NOT NULL
    `);
  }

  async stats(): Promise<SearchSyncOutboxStats> {
    const result = await this.db.execute(sql`
      SELECT
        entity,
        COUNT(*) FILTER (WHERE attempts = 0 AND dead_at IS NULL)::int AS pending,
        COUNT(*) FILTER (WHERE attempts > 0 AND dead_at IS NULL)::int AS retrying,
        COUNT(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead,
        COUNT(*) FILTER (
          WHERE locked_until <= now() AND dead_at IS NULL
        )::int AS expired_leases,
        COUNT(*) FILTER (WHERE locked_until > now() AND dead_at IS NULL)::int AS in_flight,
        COUNT(*) FILTER (
          WHERE available_at <= now()
            AND locked_until IS NULL
            AND dead_at IS NULL
        )::int AS ready,
        (
          SELECT CASE WHEN is_called THEN last_value ELSE 0 END
          FROM search_sync_revision_seq
        )::bigint AS high_water_revision,
        MIN(revision) FILTER (WHERE dead_at IS NULL)::bigint AS oldest_active_revision,
        COALESCE(
          GREATEST(
            0,
            EXTRACT(EPOCH FROM (
              now() - MIN(available_at) FILTER (
                WHERE dead_at IS NULL
                  AND locked_until IS NULL
                  AND available_at <= now()
              )
            ))
          ),
          0
        )::double precision AS oldest_ready_age_seconds
      FROM search_sync_outbox
      GROUP BY GROUPING SETS ((entity), ())
    `);
    const rows = rowsOf<{
      dead: number | string;
      entity: SearchDocumentEntity | null;
      expired_leases: number | string;
      high_water_revision: number | string;
      in_flight: number | string;
      oldest_active_revision: number | string | null;
      oldest_ready_age_seconds: number | string;
      pending: number | string;
      ready: number | string;
      retrying: number | string;
    }>(result);
    const total = rows.find((row) => row.entity === null);
    const entities = Object.fromEntries(
      SEARCH_DOCUMENT_ENTITIES.map((entity) => {
        const row = rows.find((item) => item.entity === entity);
        return [
          entity,
          {
            dead: Number(row?.dead ?? 0),
            expiredLeases: Number(row?.expired_leases ?? 0),
            inFlight: Number(row?.in_flight ?? 0),
            oldestReadyAgeSeconds: Number(row?.oldest_ready_age_seconds ?? 0),
            pending: Number(row?.pending ?? 0),
            ready: Number(row?.ready ?? 0),
            retrying: Number(row?.retrying ?? 0),
          },
        ];
      }),
    ) as Record<SearchDocumentEntity, SearchSyncOutboxEntityStats>;
    const highWaterRevision = Number(total?.high_water_revision ?? 0);
    const oldestActiveRevision =
      total?.oldest_active_revision === null || total?.oldest_active_revision === undefined
        ? null
        : Number(total.oldest_active_revision);

    return {
      dead: Number(total?.dead ?? 0),
      entities,
      expiredLeases: Number(total?.expired_leases ?? 0),
      highWaterRevision,
      inFlight: Number(total?.in_flight ?? 0),
      oldestActiveRevision,
      oldestReadyAgeSeconds: Number(total?.oldest_ready_age_seconds ?? 0),
      pending: Number(total?.pending ?? 0),
      ready: Number(total?.ready ?? 0),
      retrying: Number(total?.retrying ?? 0),
      revisionLag: oldestActiveRevision === null ? 0 : highWaterRevision - oldestActiveRevision,
    };
  }
}

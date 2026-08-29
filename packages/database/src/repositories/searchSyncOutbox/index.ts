import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../../type';
import type { SearchDocumentEntity } from '../searchDocument';
import { SEARCH_DOCUMENT_ENTITIES } from '../searchDocument';
import {
  SEARCH_SYNC_CAPTURE_TRIGGER_STATEMENTS,
  SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS,
  SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX,
} from './captureInfrastructure';

const SEARCH_SYNC_CAPTURE_SOURCE_TABLES = [
  ...new Set(SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.map(({ table }) => table)),
];
const SEARCH_SYNC_CAPTURE_SOURCE_TABLE_IDENTIFIERS = sql.join(
  SEARCH_SYNC_CAPTURE_SOURCE_TABLES.map(
    (table) => sql`${sql.identifier('public')}.${sql.identifier(table)}`,
  ),
  sql`, `,
);

export interface SearchSyncWork {
  documentId: string;
  entity: SearchDocumentEntity;
  /** Opaque fencing token that binds settlement to the worker's exact lease. */
  leaseToken: string;
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
  lease_token: string;
  revision: number | string;
}

const rowsOf = <Row>(result: unknown): Row[] => {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
};

const toWork = (row: SearchSyncRow): SearchSyncWork => ({
  documentId: row.document_id,
  entity: row.entity,
  leaseToken: row.lease_token,
  revision: Number(row.revision),
});

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2000);

const revisionNumber = (value: number | string | undefined, operation: string, minimum = 0) => {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < minimum) {
    throw new Error(`Failed to read a valid search sync revision while ${operation}`);
  }
  return revision;
};

/** Durable claim and settlement operations for the PostgreSQL-triggered search outbox. */
export class SearchSyncOutboxRepository {
  constructor(private readonly db: SearchSyncDatabase) {}

  /**
   * Installs lock-sensitive capture infrastructure outside automatic deployment migrations.
   * Each trigger is a separate short transaction, so a lock timeout can be retried without
   * rolling back triggers already installed on quieter tables.
   */
  async installCaptureInfrastructure(): Promise<void> {
    const indexResult = await this.db.execute(sql`
      SELECT indisvalid AS is_valid
      FROM pg_index
      WHERE indexrelid = to_regclass(${`public.${SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX}`})
    `);
    const [index] = rowsOf<{ is_valid: boolean }>(indexResult);
    if (!index?.is_valid) {
      throw new Error(
        `A valid ${SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX} index is required before enabling search sync capture; drop any invalid copy with DROP INDEX CONCURRENTLY, then recreate it with CREATE INDEX CONCURRENTLY`,
      );
    }

    for (const statement of SEARCH_SYNC_CAPTURE_TRIGGER_STATEMENTS) {
      await this.db.execute(statement);
    }

    const triggerTargets = sql.join(
      SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.map(
        ({ name, table }) => sql`(${name}, ${`public.${table}`}::regclass)`,
      ),
      sql`, `,
    );
    const triggerResult = await this.db.execute(sql`
      SELECT count(*)::integer AS count
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgenabled IN ('O', 'A')
        AND (tgname, tgrelid) IN (${triggerTargets})
    `);
    const installed = Number(rowsOf<{ count: number }>(triggerResult)[0]?.count ?? 0);
    if (installed !== SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.length) {
      throw new Error(
        `Failed to install search sync capture triggers (${installed}/${SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.length})`,
      );
    }
  }

  /**
   * Installs capture infrastructure, then enables it for deployments with an outbox consumer.
   * The activation fence fails fast while a writer that observed capture as disabled is active;
   * after every lock is held, new writers wait and observe capture as enabled after it commits.
   */
  async enableCapture(): Promise<void> {
    await this.installCaptureInfrastructure();
    await this.db.execute(sql`
      DO $search_sync_activation$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM search_sync_settings WHERE key = 'default' AND enabled
        ) THEN
          LOCK TABLE ${SEARCH_SYNC_CAPTURE_SOURCE_TABLE_IDENTIFIERS}
            IN SHARE MODE NOWAIT;
          INSERT INTO search_sync_settings (key, enabled)
          VALUES ('default', true)
          ON CONFLICT (key) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            updated_at = now()
          WHERE search_sync_settings.enabled IS DISTINCT FROM EXCLUDED.enabled;
        END IF;
      END;
      $search_sync_activation$ LANGUAGE plpgsql
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

  /** Returns an opaque version that changes whenever capture is enabled or disabled. */
  async getCaptureState(): Promise<{ enabled: boolean; version: string | null }> {
    const result = await this.db.execute(sql`
      SELECT
        enabled,
        EXTRACT(EPOCH FROM updated_at)::text AS version
      FROM search_sync_settings
      WHERE key = 'default'
    `);
    const state = rowsOf<{ enabled: boolean; version: string }>(result)[0];
    return state ?? { enabled: false, version: null };
  }

  async isCaptureEnabled(): Promise<boolean> {
    return (await this.getCaptureState()).enabled;
  }

  /** Observes the latest allocated revision without treating it as a committed snapshot boundary. */
  async readHighWaterRevision(): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS revision
      FROM search_sync_revision_seq
    `);
    return revisionNumber(
      rowsOf<{ revision: number | string }>(result)[0]?.revision,
      'reading the high-water mark',
    );
  }

  /** Reserves a version for idempotent full-reindex writes before Outbox changes are drained. */
  async reserveRevision(): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT nextval('search_sync_revision_seq')::bigint AS revision
    `);
    return revisionNumber(
      rowsOf<{ revision: number | string }>(result)[0]?.revision,
      'reserving a reindex version',
      1,
    );
  }

  async acknowledgeMany(works: SearchSyncWork[]): Promise<SearchSyncWork[]> {
    if (works.length === 0) return [];

    const values = sql.join(
      works.map(
        (work) =>
          sql`(${work.entity}::text, ${work.documentId}::text, ${work.revision}::bigint, ${work.leaseToken}::numeric)`,
      ),
      sql`, `,
    );
    const result = await this.db.execute(sql`
      WITH acknowledged(entity, document_id, revision, lease_token) AS (
        VALUES ${values}
      )
      DELETE FROM search_sync_outbox AS outbox
      USING acknowledged
      WHERE outbox.entity = acknowledged.entity
        AND outbox.document_id = acknowledged.document_id
        AND outbox.revision = acknowledged.revision
        AND EXTRACT(EPOCH FROM outbox.locked_until) = acknowledged.lease_token
      RETURNING outbox.entity, outbox.document_id, outbox.revision,
                EXTRACT(EPOCH FROM outbox.locked_until)::text AS lease_token
    `);

    return rowsOf<SearchSyncRow>(result).map(toWork);
  }

  /** Keeps PostgreSQL's microsecond precision in the token instead of truncating through JS Date. */
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
                  EXTRACT(EPOCH FROM outbox.locked_until)::text AS lease_token,
                  outbox.priority, outbox.available_at
      )
      SELECT entity, document_id, revision, lease_token
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

  async hasDeadLetters(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM search_sync_outbox
        WHERE dead_at IS NOT NULL
        LIMIT 1
      ) AS has_dead_letters
    `);

    return Boolean(rowsOf<{ has_dead_letters: boolean }>(result)[0]?.has_dead_letters);
  }

  async markFailures(failures: SearchSyncFailure[]): Promise<number> {
    if (failures.length === 0) return 0;

    const values = sql.join(
      failures.map(
        (failure) =>
          sql`(${failure.entity}::text, ${failure.documentId}::text, ${failure.revision}::bigint, ${failure.leaseToken}::numeric, ${errorMessage(failure.error)}::text, ${failure.permanent ?? false}::boolean)`,
      ),
      sql`, `,
    );
    const result = await this.db.execute(sql`
      WITH failed(entity, document_id, revision, lease_token, last_error, permanent) AS (
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
        AND EXTRACT(EPOCH FROM outbox.locked_until) = failed.lease_token
      RETURNING outbox.dead_at IS NOT NULL AS dead
    `);

    return rowsOf<{ dead: boolean }>(result).filter((row) => row.dead).length;
  }

  async releaseMany(works: SearchSyncWork[]): Promise<void> {
    if (works.length === 0) return;

    const values = sql.join(
      works.map(
        (work) =>
          sql`(${work.entity}::text, ${work.documentId}::text, ${work.revision}::bigint, ${work.leaseToken}::numeric)`,
      ),
      sql`, `,
    );
    await this.db.execute(sql`
      WITH released(entity, document_id, revision, lease_token) AS (
        VALUES ${values}
      )
      UPDATE search_sync_outbox AS outbox
      SET locked_until = NULL, updated_at = now()
      FROM released
      WHERE outbox.entity = released.entity
        AND outbox.document_id = released.document_id
        AND outbox.revision = released.revision
        AND EXTRACT(EPOCH FROM outbox.locked_until) = released.lease_token
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

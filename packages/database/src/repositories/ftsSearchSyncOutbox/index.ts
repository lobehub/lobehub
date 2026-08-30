import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../../type';
import type { FtsSearchDocumentEntity } from '../ftsSearchDocument';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '../ftsSearchDocument';
import {
  FTS_SEARCH_SYNC_CAPTURE_FINGERPRINT,
  FTS_SEARCH_SYNC_CAPTURE_FUNCTION_STATEMENTS,
  FTS_SEARCH_SYNC_CAPTURE_FUNCTION_TARGETS,
  FTS_SEARCH_SYNC_CAPTURE_TRIGGER_STATEMENTS,
  FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS,
  normalizeFtsSearchSyncCaptureDefinition,
} from './captureInfrastructure';

export interface FtsSearchSyncWork {
  documentId: string;
  entity: FtsSearchDocumentEntity;
  /** Opaque fencing token that binds settlement to the worker's exact lease. */
  leaseToken: string;
  revision: number;
}

export interface FtsSearchSyncFailure extends FtsSearchSyncWork {
  error: unknown;
  permanent?: boolean;
}

export interface FtsSearchSyncOutboxEntityStats {
  dead: number;
  expiredLeases: number;
  inFlight: number;
  oldestReadyAgeSeconds: number;
  pending: number;
  ready: number;
  retrying: number;
}

export interface FtsSearchSyncOutboxStats extends FtsSearchSyncOutboxEntityStats {
  entities: Record<FtsSearchDocumentEntity, FtsSearchSyncOutboxEntityStats>;
  highWaterRevision: number;
  oldestActiveRevision: number | null;
  revisionLag: number;
}

/** Approximately one day of durable retries when the exponential delay is capped at one hour. */
export const FTS_SEARCH_SYNC_MAX_ATTEMPTS = 36;

const FTS_SEARCH_SYNC_CAPTURE_SOURCE_TABLE_IDENTIFIERS = sql.join(
  [...new Set(FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.map(({ table }) => table))].map(
    (table) => sql`${sql.identifier('public')}.${sql.identifier(table)}`,
  ),
  sql`, `,
);

type FtsSearchSyncExecutor = Pick<LobeChatDatabase, 'execute'>;
type FtsSearchSyncDatabase = Pick<LobeChatDatabase, 'execute' | 'transaction'>;

interface FtsSearchSyncRow {
  document_id: string;
  entity: FtsSearchDocumentEntity;
  lease_token: string;
  revision: number | string;
}

const rowsOf = <Row>(result: unknown): Row[] => {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
};

interface CaptureInfrastructureState {
  absent: boolean;
  mismatches: string[];
  upgradeable: boolean;
}

const assertCaptureGinIndex = async (db: FtsSearchSyncExecutor): Promise<void> => {
  const indexResult = await db.execute(sql`
    SELECT (
      search_index.indisvalid
      AND search_index.indisready
      AND search_index.indislive
      AND access_method.amname = 'gin'
      AND table_namespace.nspname = 'public'
      AND source_table.relname = 'user_memories_contexts'
      AND search_index.indnkeyatts = 1
      AND search_index.indnatts = 1
      AND search_index.indexprs IS NULL
      AND search_index.indpred IS NULL
      AND indexed_attribute.attname = 'user_memory_ids'
      AND indexed_attribute.atttypid = 'jsonb'::regtype
      AND operator_class.opcintype = 'jsonb'::regtype
      AND operator_class.opcname IN ('jsonb_ops', 'jsonb_path_ops')
    ) AS is_valid
    FROM pg_index search_index
    INNER JOIN pg_class index_class ON index_class.oid = search_index.indexrelid
    INNER JOIN pg_am access_method ON access_method.oid = index_class.relam
    INNER JOIN pg_class source_table ON source_table.oid = search_index.indrelid
    INNER JOIN pg_namespace table_namespace ON table_namespace.oid = source_table.relnamespace
    INNER JOIN pg_attribute indexed_attribute
      ON indexed_attribute.attrelid = source_table.oid
      AND indexed_attribute.attnum = search_index.indkey[0]
    INNER JOIN pg_opclass operator_class ON operator_class.oid = search_index.indclass[0]
    WHERE search_index.indexrelid =
      to_regclass('public.user_memories_contexts_user_memory_ids_gin_idx')
  `);
  const [index] = rowsOf<{ is_valid: boolean }>(indexResult);
  if (!index?.is_valid) {
    throw new Error(
      'FTS search sync requires a valid, non-partial GIN index on user_memories_contexts.user_memory_ids',
    );
  }
};

const readCaptureInfrastructureState = async (
  db: FtsSearchSyncExecutor,
): Promise<CaptureInfrastructureState> => {
  const functionNames = sql.join(
    FTS_SEARCH_SYNC_CAPTURE_FUNCTION_TARGETS.map(({ name }) => sql`${name}`),
    sql`, `,
  );
  const functionResult = await db.execute(sql`
    SELECT
      pg_get_function_identity_arguments(search_function.oid) AS identity_arguments,
      search_language.lanname AS language,
      search_function.proname AS name,
      search_function.prosrc AS function_body,
      pg_get_function_result(search_function.oid) AS function_result
    FROM pg_proc search_function
    INNER JOIN pg_language search_language ON search_language.oid = search_function.prolang
    WHERE search_function.pronamespace = 'public'::regnamespace
      AND search_function.proname IN (${functionNames})
    ORDER BY search_function.proname, identity_arguments
  `);
  const functions = rowsOf<{
    function_body: string;
    function_result: string;
    identity_arguments: string;
    language: string;
    name: string;
  }>(functionResult);

  const triggerNames = sql.join(
    [...new Set(FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.map(({ name }) => name))].map(
      (name) => sql`${name}`,
    ),
    sql`, `,
  );
  const triggerResult = await db.execute(sql`
    SELECT
      pg_get_triggerdef(search_trigger.oid, false) AS definition,
      search_trigger.tgenabled AS enabled,
      search_trigger.tgname AS name,
      source_table.relname AS table_name
    FROM pg_trigger search_trigger
    INNER JOIN pg_class source_table ON source_table.oid = search_trigger.tgrelid
    INNER JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
    WHERE NOT search_trigger.tgisinternal
      AND source_namespace.nspname = 'public'
      AND search_trigger.tgname IN (${triggerNames})
    ORDER BY search_trigger.tgname, source_table.relname
  `);
  const triggers = rowsOf<{
    definition: string;
    enabled: string;
    name: string;
    table_name: string;
  }>(triggerResult);

  const mismatches: string[] = [];
  let functionsMatch = functions.length === FTS_SEARCH_SYNC_CAPTURE_FUNCTION_TARGETS.length;
  if (!functionsMatch) {
    mismatches.push(
      `functions ${functions.length}/${FTS_SEARCH_SYNC_CAPTURE_FUNCTION_TARGETS.length}`,
    );
  }
  for (const expected of FTS_SEARCH_SYNC_CAPTURE_FUNCTION_TARGETS) {
    const actual = functions.find(
      ({ identity_arguments: identityArguments, name }) =>
        name === expected.name && identityArguments === expected.identityArguments,
    );
    if (
      !actual ||
      actual.function_body.trim() !== expected.body ||
      actual.function_result !== expected.result ||
      actual.language !== 'plpgsql'
    ) {
      functionsMatch = false;
      mismatches.push(`function ${expected.name}`);
    }
  }

  let triggersMatchKnownVersion =
    triggers.length === FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.length;
  if (!triggersMatchKnownVersion) {
    mismatches.push(
      `triggers ${triggers.length}/${FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS.length}`,
    );
  }
  for (const expected of FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS) {
    const actual = triggers.find(
      ({ name, table_name: table }) => name === expected.name && table === expected.table,
    );
    const actualDefinition = actual
      ? normalizeFtsSearchSyncCaptureDefinition(actual.definition)
      : undefined;
    const enabled = actual ? ['A', 'O'].includes(actual.enabled) : false;
    const current = enabled && actualDefinition === expected.definition;
    const previous =
      enabled &&
      actualDefinition !== undefined &&
      expected.previousDefinitions.includes(actualDefinition);
    if (!current) {
      mismatches.push(`trigger ${expected.name}`);
    }
    if (!current && !previous) triggersMatchKnownVersion = false;
  }

  return {
    absent: functions.length === 0 && triggers.length === 0,
    mismatches,
    upgradeable: functionsMatch && triggersMatchKnownVersion && mismatches.length > 0,
  };
};

const assertCaptureDefinitions = async (db: FtsSearchSyncExecutor): Promise<void> => {
  const state = await readCaptureInfrastructureState(db);
  if (state.mismatches.length > 0) {
    throw new Error(
      `FTS search sync capture infrastructure does not match the expected definition: ${state.mismatches.join(', ')}`,
    );
  }
};

const toWork = (row: FtsSearchSyncRow): FtsSearchSyncWork => ({
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
    throw new Error(`Failed to read a valid FTS search sync revision while ${operation}`);
  }
  return revision;
};

const lockCaptureSourceWrites = async (transaction: FtsSearchSyncExecutor): Promise<void> => {
  await transaction.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await transaction.execute(
    sql`LOCK TABLE ${FTS_SEARCH_SYNC_CAPTURE_SOURCE_TABLE_IDENTIFIERS} IN SHARE MODE`,
  );
};

/** Durable claim and settlement operations for the PostgreSQL-triggered search outbox. */
export class FtsSearchSyncOutboxRepository {
  constructor(private readonly db: FtsSearchSyncDatabase) {}

  /**
   * Installs all capture functions and triggers as one definition-checked transaction.
   * Repeated deployments only validate the existing definition and perform no DDL. A partial,
   * disabled, or unknown definition fails closed instead of silently repairing a capture gap.
   */
  async installCaptureInfrastructure(): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SET LOCAL lock_timeout = '3s'`);
      /** Serialize installers before inspecting state so two deployments cannot both create DDL. */
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('lobehub.fts_search_sync_capture'))`,
      );
      await assertCaptureGinIndex(transaction);

      const state = await readCaptureInfrastructureState(transaction);
      if (state.mismatches.length === 0) return;
      if (state.upgradeable) {
        /** The transaction keeps writers from observing a capture gap during the known upgrade. */
        for (const { name, table } of FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS) {
          await transaction.execute(sql.raw(`DROP TRIGGER "${name}" ON public."${table}"`));
        }
        for (const statement of FTS_SEARCH_SYNC_CAPTURE_TRIGGER_STATEMENTS) {
          await transaction.execute(statement);
        }
        await assertCaptureDefinitions(transaction);
        return;
      }
      if (!state.absent) {
        throw new Error(
          `Refusing to replace partial or unknown FTS search sync capture infrastructure: ${state.mismatches.join(', ')}`,
        );
      }

      for (const statement of FTS_SEARCH_SYNC_CAPTURE_FUNCTION_STATEMENTS) {
        await transaction.execute(statement);
      }
      for (const statement of FTS_SEARCH_SYNC_CAPTURE_TRIGGER_STATEMENTS) {
        await transaction.execute(statement);
      }

      await assertCaptureDefinitions(transaction);
    });
  }

  /** Fails before a reindex or incremental drain if capture is missing, disabled, or stale. */
  async assertCaptureInfrastructure(): Promise<void> {
    await assertCaptureGinIndex(this.db);
    await assertCaptureDefinitions(this.db);
  }

  /** Returns the code-derived fingerprint only after the live definitions match it exactly. */
  async readCaptureFingerprint(): Promise<string> {
    await this.assertCaptureInfrastructure();
    return FTS_SEARCH_SYNC_CAPTURE_FINGERPRINT;
  }

  /** Observes the latest allocated revision without treating it as a committed snapshot boundary. */
  async readHighWaterRevision(): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS revision
      FROM fts_search_sync_revision_seq
    `);
    return revisionNumber(
      rowsOf<{ revision: number | string }>(result)[0]?.revision,
      'reading the high-water mark',
    );
  }

  /**
   * Returns a revision boundary only after every earlier capture-source writer has committed or
   * rolled back. Sequence allocation is non-transactional, so reading it before taking the SHARE
   * locks could include a revision whose Outbox row is still invisible and later commits after the
   * validation snapshot. The locks close that race without allocating a revision or mutating rows.
   */
  async readCommittedRevisionBoundary(): Promise<number> {
    return this.db.transaction(async (transaction) => {
      await lockCaptureSourceWrites(transaction);
      const result = await transaction.execute(sql`
        SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS revision
        FROM fts_search_sync_revision_seq
      `);
      return revisionNumber(
        rowsOf<{ revision: number | string }>(result)[0]?.revision,
        'reading the committed revision boundary',
      );
    });
  }

  /**
   * Reserves the full-reindex version, then waits for writers that allocated an older revision.
   * Without this fence, a long transaction could commit an older Outbox revision after the
   * backfill has already written stale data at the newer base revision.
   */
  async reserveRevisionWithWriteFence(): Promise<number> {
    return this.db.transaction(async (transaction) => {
      const result = await transaction.execute(sql`
        SELECT nextval('fts_search_sync_revision_seq')::bigint AS revision
      `);
      const revision = revisionNumber(
        rowsOf<{ revision: number | string }>(result)[0]?.revision,
        'reserving a reindex version',
        1,
      );
      await lockCaptureSourceWrites(transaction);
      return revision;
    });
  }

  /** Re-establishes the write fence before resuming a checkpoint created by an older process. */
  async fenceSourceWrites(): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await lockCaptureSourceWrites(transaction);
    });
  }

  async acknowledgeMany(works: FtsSearchSyncWork[]): Promise<FtsSearchSyncWork[]> {
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
      DELETE FROM fts_search_sync_outbox AS outbox
      USING acknowledged
      WHERE outbox.entity = acknowledged.entity
        AND outbox.document_id = acknowledged.document_id
        AND outbox.revision = acknowledged.revision
        AND EXTRACT(EPOCH FROM outbox.locked_until) = acknowledged.lease_token
      RETURNING outbox.entity, outbox.document_id, outbox.revision,
                EXTRACT(EPOCH FROM outbox.locked_until)::text AS lease_token
    `);

    return rowsOf<FtsSearchSyncRow>(result).map(toWork);
  }

  /** Keeps PostgreSQL's microsecond precision in the token instead of truncating through JS Date. */
  async claim(limit = 100, leaseSeconds = 300): Promise<FtsSearchSyncWork[]> {
    const result = await this.db.execute(sql`
      WITH expired_candidates AS MATERIALIZED (
        SELECT entity, document_id
        FROM fts_search_sync_outbox
        WHERE locked_until <= now()
          AND dead_at IS NULL
        ORDER BY locked_until, revision
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ), expired AS MATERIALIZED (
        UPDATE fts_search_sync_outbox AS outbox
        SET attempts = outbox.attempts + 1,
            available_at = now() + make_interval(
              secs => GREATEST(30, LEAST(POWER(2, outbox.attempts)::double precision, 3600))
            ),
            dead_at = CASE
              WHEN outbox.attempts + 1 >= ${FTS_SEARCH_SYNC_MAX_ATTEMPTS} THEN now()
              ELSE outbox.dead_at
            END,
            last_error = 'FTS search sync lease expired before settlement',
            locked_until = NULL,
            updated_at = now()
        FROM expired_candidates
        WHERE outbox.entity = expired_candidates.entity
          AND outbox.document_id = expired_candidates.document_id
        RETURNING outbox.entity, outbox.document_id
      ), candidates AS (
        SELECT entity, document_id, revision
        FROM fts_search_sync_outbox
        WHERE available_at <= now()
          AND locked_until IS NULL
          AND dead_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM expired
            WHERE expired.entity = fts_search_sync_outbox.entity
              AND expired.document_id = fts_search_sync_outbox.document_id
          )
        ORDER BY priority, available_at, revision
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      , claimed AS (
        UPDATE fts_search_sync_outbox AS outbox
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

    return rowsOf<FtsSearchSyncRow>(result).map(toWork);
  }

  async hasActionableWork(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM fts_search_sync_outbox
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
        FROM fts_search_sync_outbox
        WHERE dead_at IS NOT NULL
        LIMIT 1
      ) AS has_dead_letters
    `);

    return Boolean(rowsOf<{ has_dead_letters: boolean }>(result)[0]?.has_dead_letters);
  }

  async markFailures(failures: FtsSearchSyncFailure[]): Promise<number> {
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
      UPDATE fts_search_sync_outbox AS outbox
      SET attempts = outbox.attempts + 1,
          available_at = CASE
            WHEN failed.permanent THEN outbox.available_at
            ELSE now() + make_interval(
              secs => GREATEST(30, LEAST(POWER(2, outbox.attempts)::double precision, 3600))
            )
          END,
          dead_at = CASE
            WHEN failed.permanent OR outbox.attempts + 1 >= ${FTS_SEARCH_SYNC_MAX_ATTEMPTS} THEN now()
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

  async releaseMany(works: FtsSearchSyncWork[]): Promise<void> {
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
      UPDATE fts_search_sync_outbox AS outbox
      SET locked_until = NULL, updated_at = now()
      FROM released
      WHERE outbox.entity = released.entity
        AND outbox.document_id = released.document_id
        AND outbox.revision = released.revision
        AND EXTRACT(EPOCH FROM outbox.locked_until) = released.lease_token
    `);
  }

  async stats(): Promise<FtsSearchSyncOutboxStats> {
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
          FROM fts_search_sync_revision_seq
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
      FROM fts_search_sync_outbox
      GROUP BY GROUPING SETS ((entity), ())
    `);
    const rows = rowsOf<{
      dead: number | string;
      entity: FtsSearchDocumentEntity | null;
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
      FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => {
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
    ) as Record<FtsSearchDocumentEntity, FtsSearchSyncOutboxEntityStats>;
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

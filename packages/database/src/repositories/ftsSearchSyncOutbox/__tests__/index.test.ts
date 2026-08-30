// @vitest-environment node
import path from 'node:path';

import type { SQL } from 'drizzle-orm';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, ftsSearchSyncOutbox, users } from '../../../schemas';
import { FtsSearchDocumentBuilder } from '../../ftsSearchDocument';
import { FtsSearchSyncOutboxRepository } from '..';
import {
  FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS,
  FTS_SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX,
} from '../captureInfrastructure';

const USER_ID = 'fts-search-sync-integration-user';
const CAPTURE_INSTALL_TEST_TIMEOUT = 30_000;
const FTS_SEARCH_SYNC_TRIGGER_TARGETS = [
  { name: 'fts_search_sync_agents', table: 'agents' },
  { name: 'fts_search_sync_chat_groups', table: 'chat_groups' },
  { name: 'fts_search_sync_documents', table: 'documents' },
  { name: 'fts_search_sync_files', table: 'files' },
  { name: 'fts_search_sync_knowledge_base_files', table: 'knowledge_base_files' },
  { name: 'fts_search_sync_knowledge_bases', table: 'knowledge_bases' },
  { name: 'fts_search_sync_memory_activities', table: 'user_memories_activities' },
  { name: 'fts_search_sync_memory_contexts', table: 'user_memories_contexts' },
  { name: 'fts_search_sync_memory_experiences', table: 'user_memories_experiences' },
  { name: 'fts_search_sync_memory_identities', table: 'user_memories_identities' },
  { name: 'fts_search_sync_memory_preferences', table: 'user_memories_preferences' },
  { name: 'fts_search_sync_messages', table: 'messages' },
  { name: 'fts_search_sync_persona_documents', table: 'user_memory_persona_documents' },
  { name: 'fts_search_sync_topics', table: 'topics' },
  { name: 'fts_search_sync_user_memories', table: 'user_memories' },
  { name: 'fts_search_sync_user_memories_fanout', table: 'user_memories' },
] as const;
const FTS_SEARCH_SYNC_CAPTURE_FUNCTION_NAMES = [
  'capture_fts_search_sync_change',
  'capture_fts_search_sync_knowledge_base_files',
  'capture_fts_search_sync_memory_fanout',
  'enqueue_fts_search_sync_outbox',
] as const;

const db = await getTestDB();
const builder = new FtsSearchDocumentBuilder(db);
const repository = new FtsSearchSyncOutboxRepository(db);
let restoreCaptureInfrastructure = false;

const sortKeys = (keys: { documentId: string; entity: string }[]) =>
  keys.toSorted((left, right) =>
    `${left.entity}:${left.documentId}`.localeCompare(`${right.entity}:${right.documentId}`),
  );

const normalizeSql = (statement: SQL) =>
  new PgDialect().sqlToQuery(statement).sql.replaceAll(/\s+/g, ' ').trim();

const createRecordedRepository = (revisionRows: unknown[]) => {
  const statements: string[] = [];
  const execute = vi.fn(async (statement: SQL) => {
    const normalized = normalizeSql(statement);
    statements.push(normalized);
    return normalized.includes('FROM fts_search_sync_revision_seq') ? { rows: revisionRows } : [];
  });
  const database = {
    execute,
    transaction: async (callback: (transaction: { execute: typeof execute }) => Promise<unknown>) =>
      callback({ execute }),
  } as unknown as ConstructorParameters<typeof FtsSearchSyncOutboxRepository>[0];

  return { repository: new FtsSearchSyncOutboxRepository(database), statements };
};

const dropCaptureInfrastructure = async () => {
  for (const { name, table } of FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS) {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${name}" ON "${table}"`));
  }

  for (const functionName of FTS_SEARCH_SYNC_CAPTURE_FUNCTION_NAMES) {
    const signature =
      functionName === 'enqueue_fts_search_sync_outbox' ? '(text, text[], smallint)' : '()';
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${functionName}"${signature}`));
  }
};

const hasCompleteCaptureInfrastructure = async () => {
  const triggerTargets = sql.join(
    FTS_SEARCH_SYNC_TRIGGER_TARGETS.map(
      ({ name, table }) => sql`(${name}, ${`public.${table}`}::regclass)`,
    ),
    sql`, `,
  );
  const functionNames = sql.join(
    FTS_SEARCH_SYNC_CAPTURE_FUNCTION_NAMES.map((name) => sql`${name}`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_index
        WHERE indexrelid = to_regclass(${`public.${FTS_SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX}`})
          AND indisready
          AND indisvalid
      ) AS has_gin_index,
      (
        SELECT count(DISTINCT proname)::integer
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN (${functionNames})
      ) AS function_count,
      (
        SELECT count(*)::integer
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND (tgname, tgrelid) IN (${triggerTargets})
      ) AS trigger_count,
      (
        SELECT count(*)::integer
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgenabled IN ('O', 'A')
          AND (tgname, tgrelid) IN (${triggerTargets})
      ) AS enabled_trigger_count
  `);
  const [row] = Array.isArray(result) ? result : result.rows;

  return (
    row?.has_gin_index === true &&
    Number(row.function_count) === FTS_SEARCH_SYNC_CAPTURE_FUNCTION_NAMES.length &&
    Number(row.trigger_count) === FTS_SEARCH_SYNC_TRIGGER_TARGETS.length &&
    Number(row.enabled_trigger_count) === FTS_SEARCH_SYNC_TRIGGER_TARGETS.length
  );
};

beforeAll(async () => {
  restoreCaptureInfrastructure = await hasCompleteCaptureInfrastructure();
  await dropCaptureInfrastructure();
}, CAPTURE_INSTALL_TEST_TIMEOUT);

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(ftsSearchSyncOutbox);
  await db.insert(users).values({ id: USER_ID });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(ftsSearchSyncOutbox);
  await dropCaptureInfrastructure();
  if (restoreCaptureInfrastructure) {
    await repository.installCaptureInfrastructure();
  }
}, CAPTURE_INSTALL_TEST_TIMEOUT);

describe.sequential('FtsSearchSyncOutboxRepository', () => {
  it('keeps optional capture infrastructure out of the deployment migration', () => {
    const migration = readMigrationFiles({
      migrationsFolder: path.join(__dirname, '../../../../migrations'),
    }).find((item) =>
      item.sql.some(
        (statement) =>
          statement.includes('fts_search_sync_revision_seq') &&
          statement.includes('fts_search_sync_outbox'),
      ),
    );

    if (!migration) throw new Error('FTS search sync migration was not generated');
    const migrationSql = migration.sql.join('\n');

    expect(migrationSql).toContain('fts_search_sync_revision_seq');
    expect(migrationSql).toContain('fts_search_sync_outbox');
    expect(migrationSql).not.toContain('CREATE TRIGGER');
    expect(migrationSql).not.toContain('capture_fts_search_sync_change');
    expect(migrationSql).not.toContain("set_config('lock_timeout', '3s', true)");
    expect(migrationSql).toContain(FTS_SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX);
    expect(migrationSql).not.toContain('fts_search_sync_settings');
  });

  it('does not install capture infrastructure or enqueue ordinary writes by default', async () => {
    const triggerResult = await db.execute(sql`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname LIKE 'fts_search_sync_%'
      ORDER BY tgname
    `);
    const triggerRows = Array.isArray(triggerResult) ? triggerResult : triggerResult.rows;
    expect(triggerRows).toEqual([]);

    const indexResult = await db.execute(sql`
      SELECT to_regclass(${`public.${FTS_SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX}`})::text AS index_name
    `);
    const indexRows = Array.isArray(indexResult) ? indexResult : indexResult.rows;
    expect(indexRows).toEqual([{ index_name: FTS_SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX }]);

    const functionResult = await db.execute(sql`
      SELECT proname
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (${sql.join(
          FTS_SEARCH_SYNC_CAPTURE_FUNCTION_NAMES.map((name) => sql`${name}`),
          sql`, `,
        )})
      ORDER BY proname
    `);
    const functionRows = Array.isArray(functionResult) ? functionResult : functionResult.rows;
    expect(functionRows).toEqual([]);

    await db.insert(agents).values({ id: 'base-agent', title: 'one', userId: USER_ID });
    await expect(db.select().from(ftsSearchSyncOutbox)).resolves.toEqual([]);
  });

  it('replays the outbox migration safely', async () => {
    const migration = readMigrationFiles({
      migrationsFolder: path.join(__dirname, '../../../../migrations'),
    }).find((item) =>
      item.sql.some(
        (statement) =>
          statement.includes('fts_search_sync_revision_seq') &&
          statement.includes('fts_search_sync_outbox'),
      ),
    );

    if (!migration) throw new Error('FTS search sync migration was not generated');
    for (const statement of migration.sql) await db.execute(sql.raw(statement));

    const outboxResult = await db.execute(
      sql`SELECT to_regclass('public.fts_search_sync_outbox')::text AS table_name`,
    );
    const outboxRows = Array.isArray(outboxResult) ? outboxResult : outboxResult.rows;
    expect(outboxRows).toEqual([{ table_name: 'fts_search_sync_outbox' }]);
  });

  it('indexes durable dead-letter checks', async () => {
    const result = await db.execute(sql`
      SELECT to_regclass('fts_search_sync_outbox_dead_idx')::text AS index_name
    `);
    const rows = Array.isArray(result) ? result : result.rows;

    expect(rows).toEqual([{ index_name: 'fts_search_sync_outbox_dead_idx' }]);
  });

  it(
    'requires the schema-managed GIN index and installs all exact capture triggers',
    async () => {
      await repository.installCaptureInfrastructure();

      const result = await db.execute(sql`
      SELECT pg_trigger.tgname, pg_trigger.tgenabled, source_table.relname AS table_name
      FROM pg_trigger
      JOIN pg_class AS source_table ON source_table.oid = pg_trigger.tgrelid
      JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_table.relnamespace
      WHERE NOT tgisinternal AND tgname LIKE 'fts_search_sync_%'
        AND source_namespace.nspname = 'public'
      ORDER BY tgname
    `);
      const rows = Array.isArray(result) ? result : result.rows;

      expect(rows).toEqual(
        FTS_SEARCH_SYNC_TRIGGER_TARGETS.map(({ name: tgname, table: table_name }) => ({
          tgname,
          tgenabled: 'O',
          table_name,
        })),
      );

      const indexResult = await db.execute(sql`
      SELECT
        access_method.amname AS access_method,
        indexed_attribute.attname AS indexed_column,
        indexed_attribute.atttypid = 'jsonb'::regtype AS is_jsonb,
        search_index.indpred IS NULL AS is_not_partial,
        search_index.indisready AS is_ready,
        search_index.indisvalid AS is_valid
      FROM pg_index AS search_index
      JOIN pg_class AS index_relation ON index_relation.oid = search_index.indexrelid
      JOIN pg_am AS access_method ON access_method.oid = index_relation.relam
      JOIN pg_attribute AS indexed_attribute
        ON indexed_attribute.attrelid = search_index.indrelid
        AND indexed_attribute.attnum = ANY(search_index.indkey)
      WHERE search_index.indexrelid =
        'user_memories_contexts_user_memory_ids_gin_idx'::regclass
    `);
      const indexRows = Array.isArray(indexResult) ? indexResult : indexResult.rows;
      expect(indexRows).toEqual([
        {
          access_method: 'gin',
          indexed_column: 'user_memory_ids',
          is_jsonb: true,
          is_not_partial: true,
          is_ready: true,
          is_valid: true,
        },
      ]);
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it(
    'keeps capture installation idempotent',
    async () => {
      await expect(repository.installCaptureInfrastructure()).resolves.toBeUndefined();
      const firstResult = await db.execute(sql`
      SELECT oid::text, tgname
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname LIKE 'fts_search_sync_%'
      ORDER BY tgname
    `);
      const firstRows = Array.isArray(firstResult) ? firstResult : firstResult.rows;

      await expect(repository.installCaptureInfrastructure()).resolves.toBeUndefined();

      const result = await db.execute(sql`
      SELECT oid::text, tgname
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname LIKE 'fts_search_sync_%'
      ORDER BY tgname
    `);
      const rows = Array.isArray(result) ? result : result.rows;
      expect(rows).toEqual(firstRows);
      expect(rows).toHaveLength(16);
      await expect(repository.readCaptureFingerprint()).resolves.toMatch(/^[a-f\d]{64}$/);
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it(
    'atomically upgrades the known predecessor trigger definition',
    async () => {
      await db.execute(sql`DROP TRIGGER fts_search_sync_agents ON public.agents`);
      await db.execute(sql`
        CREATE TRIGGER fts_search_sync_agents
        AFTER INSERT OR DELETE OR UPDATE OF
          description, slug, system_role, tags, title, user_id, virtual, visibility, workspace_id
        ON public.agents
        FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
          'agents', 'user_id', 'visibility', 'workspace_id'
        )
      `);

      try {
        await expect(repository.assertCaptureInfrastructure()).rejects.toThrow(
          'trigger fts_search_sync_agents',
        );
        await expect(repository.installCaptureInfrastructure()).resolves.toBeUndefined();
        await expect(repository.assertCaptureInfrastructure()).resolves.toBeUndefined();
      } finally {
        try {
          await repository.assertCaptureInfrastructure();
        } catch {
          await dropCaptureInfrastructure();
          await repository.installCaptureInfrastructure();
        }
      }
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it(
    'rejects a managed trigger name installed on an unexpected public table',
    async () => {
      await db.execute(sql`
        CREATE TRIGGER fts_search_sync_agents
        AFTER INSERT ON users
        FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change('agents', 'id')
      `);
      try {
        await expect(repository.assertCaptureInfrastructure()).rejects.toThrow('triggers 17/16');
        await expect(repository.installCaptureInfrastructure()).rejects.toThrow(
          'Refusing to replace partial or unknown FTS search sync capture infrastructure',
        );
      } finally {
        await db.execute(sql`DROP TRIGGER IF EXISTS fts_search_sync_agents ON users`);
      }

      await expect(repository.assertCaptureInfrastructure()).resolves.toBeUndefined();
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it('reserves and fences revisions for a local full-reindex checkpoint', async () => {
    const revision = await repository.reserveRevisionWithWriteFence();

    expect(revision).toBeGreaterThan(0);
    await expect(repository.readHighWaterRevision()).resolves.toBeGreaterThanOrEqual(revision);
  });

  it('reads a committed revision boundary without allocating a new revision', async () => {
    const before = await repository.readHighWaterRevision();

    await expect(repository.readCommittedRevisionBoundary()).resolves.toBe(before);
    await expect(repository.readHighWaterRevision()).resolves.toBe(before);
  });

  it('locks capture sources before reading the committed revision boundary', async () => {
    const { repository: recordedRepository, statements } = createRecordedRepository([
      { revision: '42' },
    ]);

    await expect(recordedRepository.readCommittedRevisionBoundary()).resolves.toBe(42);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe("SET LOCAL lock_timeout = '3s'");
    expect(statements[1]).toMatch(/^LOCK TABLE .* IN SHARE MODE$/);
    expect(statements[2]).toBe(
      'SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS revision FROM fts_search_sync_revision_seq',
    );
  });

  it('rejects an invalid committed revision boundary', async () => {
    const { repository: recordedRepository } = createRecordedRepository([]);

    await expect(recordedRepository.readCommittedRevisionBoundary()).rejects.toThrow(
      'Failed to read a valid FTS search sync revision while reading the committed revision boundary',
    );
  });

  it(
    'validates capture infrastructure and rejects a disabled trigger',
    async () => {
      await expect(repository.assertCaptureInfrastructure()).resolves.toBeUndefined();

      await db.execute(sql`ALTER TABLE agents DISABLE TRIGGER fts_search_sync_agents`);
      try {
        await expect(repository.assertCaptureInfrastructure()).rejects.toThrow(
          'trigger fts_search_sync_agents',
        );
        await expect(repository.installCaptureInfrastructure()).rejects.toThrow(
          'Refusing to replace partial or unknown FTS search sync capture infrastructure',
        );
      } finally {
        await db.execute(sql`ALTER TABLE agents ENABLE TRIGGER fts_search_sync_agents`);
      }

      await expect(repository.assertCaptureInfrastructure()).resolves.toBeUndefined();
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it(
    'refuses to continue from a partial trigger installation',
    async () => {
      await db.execute(sql`DROP TRIGGER fts_search_sync_agents ON agents`);
      try {
        await expect(repository.installCaptureInfrastructure()).rejects.toThrow(
          'Refusing to replace partial or unknown FTS search sync capture infrastructure',
        );
        const result = await db.execute(sql`
        SELECT to_regclass('public.agents') IS NOT NULL AND EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'fts_search_sync_agents' AND tgrelid = 'public.agents'::regclass
        ) AS restored
      `);
        const rows = Array.isArray(result) ? result : result.rows;
        expect(rows).toEqual([{ restored: false }]);
      } finally {
        await dropCaptureInfrastructure();
        await repository.installCaptureInfrastructure();
      }
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it(
    'rejects a stale function body instead of treating its name as installed',
    async () => {
      await db.execute(
        sql.raw(`
      CREATE OR REPLACE FUNCTION capture_fts_search_sync_change() RETURNS trigger AS $$
      BEGIN
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `),
      );
      try {
        await expect(repository.assertCaptureInfrastructure()).rejects.toThrow(
          'function capture_fts_search_sync_change',
        );
        await expect(repository.installCaptureInfrastructure()).rejects.toThrow(
          'Refusing to replace partial or unknown FTS search sync capture infrastructure',
        );
      } finally {
        await dropCaptureInfrastructure();
        await repository.installCaptureInfrastructure();
      }
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it('captures the first mutation immediately after opt-in installation', async () => {
    await db.insert(agents).values({ id: 'immediate-agent', title: 'one', userId: USER_ID });

    await expect(
      db
        .select({ documentId: ftsSearchSyncOutbox.documentId, entity: ftsSearchSyncOutbox.entity })
        .from(ftsSearchSyncOutbox),
    ).resolves.toEqual([{ documentId: 'immediate-agent', entity: 'agents' }]);
  });

  it('coalesces mutations and increases the revision, prioritizing revocations', async () => {
    await db.insert(agents).values({ id: 'sync-agent', title: 'one', userId: USER_ID });
    const [inserted] = await db
      .select()
      .from(ftsSearchSyncOutbox)
      .where(
        and(
          eq(ftsSearchSyncOutbox.entity, 'agents'),
          eq(ftsSearchSyncOutbox.documentId, 'sync-agent'),
        ),
      );

    await db
      .update(agents)
      .set({ title: 'two', visibility: 'private' })
      .where(eq(agents.id, 'sync-agent'));
    const rows = await db
      .select()
      .from(ftsSearchSyncOutbox)
      .where(
        and(
          eq(ftsSearchSyncOutbox.entity, 'agents'),
          eq(ftsSearchSyncOutbox.documentId, 'sync-agent'),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].revision).toBeGreaterThan(inserted.revision);
    expect(rows[0].priority).toBe(0);

    await db.delete(agents).where(eq(agents.id, 'sync-agent'));
    const [deleted] = await db
      .select()
      .from(ftsSearchSyncOutbox)
      .where(eq(ftsSearchSyncOutbox.documentId, 'sync-agent'));
    expect(deleted.revision).toBeGreaterThan(rows[0].revision);
    expect(deleted.priority).toBe(0);
  });

  it('does not enqueue an update that changes only an unprojected field', async () => {
    await db.insert(agents).values({ id: 'unprojected-agent', title: 'one', userId: USER_ID });
    await db.delete(ftsSearchSyncOutbox);

    await db.execute(sql`UPDATE agents SET pinned = true WHERE id = 'unprojected-agent'`);

    const rows = await db.select().from(ftsSearchSyncOutbox);
    expect(rows).toEqual([]);
  });

  it('enqueues an update that changes only the projected updated_at field', async () => {
    await db.insert(agents).values({ id: 'updated-at-agent', title: 'one', userId: USER_ID });
    await db.delete(ftsSearchSyncOutbox);

    await db
      .update(agents)
      .set({ updatedAt: new Date('2026-08-30T00:00:00.000Z') })
      .where(eq(agents.id, 'updated-at-agent'));

    await expect(
      db
        .select({ documentId: ftsSearchSyncOutbox.documentId, entity: ftsSearchSyncOutbox.entity })
        .from(ftsSearchSyncOutbox),
    ).resolves.toEqual([{ documentId: 'updated-at-agent', entity: 'agents' }]);
  });

  it('rolls the outbox entry back with the source transaction', async () => {
    await expect(
      db.transaction(async (transaction) => {
        await transaction
          .insert(agents)
          .values({ id: 'rolled-back-agent', title: 'temporary', userId: USER_ID });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const rows = await db
      .select()
      .from(ftsSearchSyncOutbox)
      .where(eq(ftsSearchSyncOutbox.documentId, 'rolled-back-agent'));
    expect(rows).toEqual([]);
  });

  it('uses revisions to reject stale acknowledgements after a newer mutation', async () => {
    await db.insert(agents).values({ id: 'revision-agent', title: 'one', userId: USER_ID });
    const [first] = await repository.claim();

    await db.update(agents).set({ title: 'two' }).where(eq(agents.id, 'revision-agent'));

    await expect(repository.acknowledgeMany([first])).resolves.toEqual([]);
    const [second] = await repository.claim();
    expect(second.revision).toBeGreaterThan(first.revision);
    await expect(repository.acknowledgeMany([second])).resolves.toEqual([second]);
    await expect(repository.stats()).resolves.toMatchObject({ pending: 0, ready: 0 });
  });

  it('keeps concurrent claims disjoint and marks permanent failures dead', async () => {
    await db.insert(agents).values([
      { id: 'claim-agent-a', title: 'a', userId: USER_ID },
      { id: 'claim-agent-b', title: 'b', userId: USER_ID },
    ]);

    const [first] = await repository.claim(1);
    const [second] = await repository.claim(1);
    expect(second.documentId).not.toBe(first.documentId);

    await expect(
      repository.markFailures([{ ...first, error: new Error('invalid mapping'), permanent: true }]),
    ).resolves.toBe(1);
    await expect(repository.hasDeadLetters()).resolves.toBe(true);
    const [dead] = await db
      .select()
      .from(ftsSearchSyncOutbox)
      .where(eq(ftsSearchSyncOutbox.documentId, first.documentId));
    expect(dead.deadAt).toBeInstanceOf(Date);
    expect(dead.lastError).toBe('invalid mapping');

    await repository.releaseMany([second]);
    await expect(repository.stats()).resolves.toMatchObject({ dead: 1, inFlight: 0, ready: 1 });
  });

  it('prevents stale workers from settling a reclaimed lease', async () => {
    await db.insert(agents).values({ id: 'reclaimed-agent', title: 'one', userId: USER_ID });
    const [stale] = await repository.claim(1, 1);

    /** Simulate the lease reaper making the same revision available to another worker. */
    await db
      .update(ftsSearchSyncOutbox)
      .set({ availableAt: new Date(0), lockedUntil: null })
      .where(eq(ftsSearchSyncOutbox.documentId, stale.documentId));
    const [current] = await repository.claim(1, 300);
    expect(current.leaseToken).not.toBe(stale.leaseToken);
    const [claimedRow] = await db
      .select()
      .from(ftsSearchSyncOutbox)
      .where(eq(ftsSearchSyncOutbox.documentId, current.documentId));

    await repository.releaseMany([stale]);
    await expect(
      db
        .select()
        .from(ftsSearchSyncOutbox)
        .where(eq(ftsSearchSyncOutbox.documentId, current.documentId)),
    ).resolves.toMatchObject([{ lockedUntil: claimedRow.lockedUntil }]);

    await repository.markFailures([
      { ...stale, error: new Error('late failure'), permanent: true },
    ]);
    await expect(
      db
        .select()
        .from(ftsSearchSyncOutbox)
        .where(eq(ftsSearchSyncOutbox.documentId, current.documentId)),
    ).resolves.toMatchObject([
      {
        attempts: claimedRow.attempts,
        deadAt: claimedRow.deadAt,
        lastError: claimedRow.lastError,
        lockedUntil: claimedRow.lockedUntil,
      },
    ]);

    await expect(repository.acknowledgeMany([stale])).resolves.toEqual([]);
    await expect(repository.acknowledgeMany([current])).resolves.toEqual([current]);
  });

  it('returns revocations before ordinary edits', async () => {
    await db.insert(agents).values([
      { id: 'ordinary-agent', title: 'before', userId: USER_ID },
      { id: 'revoked-agent', title: 'before', userId: USER_ID },
    ]);
    await db.delete(ftsSearchSyncOutbox);
    await db.update(agents).set({ title: 'after' }).where(eq(agents.id, 'ordinary-agent'));
    await db.update(agents).set({ visibility: 'private' }).where(eq(agents.id, 'revoked-agent'));

    await expect(repository.claim(2)).resolves.toMatchObject([
      { documentId: 'revoked-agent' },
      { documentId: 'ordinary-agent' },
    ]);
  });

  it('reports a retry as dead when it exhausts the attempt budget', async () => {
    await db.insert(agents).values({ id: 'exhausted-agent', title: 'one', userId: USER_ID });
    const [claimed] = await repository.claim(1);
    await db
      .update(ftsSearchSyncOutbox)
      .set({ attempts: 35 })
      .where(eq(ftsSearchSyncOutbox.documentId, claimed.documentId));

    await expect(
      repository.markFailures([{ ...claimed, error: new Error('still failing') }]),
    ).resolves.toBe(1);
    await expect(repository.stats()).resolves.toMatchObject({ dead: 1, ready: 0 });
  });

  it('reaps expired leases into delayed retry without reclaiming them immediately', async () => {
    await db.insert(agents).values({ id: 'expired-agent', title: 'one', userId: USER_ID });
    const [claimed] = await repository.claim(1);
    await db
      .update(ftsSearchSyncOutbox)
      .set({ lockedUntil: new Date(0) })
      .where(eq(ftsSearchSyncOutbox.documentId, claimed.documentId));

    await expect(repository.stats()).resolves.toMatchObject({
      expiredLeases: 1,
      inFlight: 0,
      ready: 0,
    });
    await expect(repository.claim(1)).resolves.toEqual([]);
    const [retried] = await db
      .select()
      .from(ftsSearchSyncOutbox)
      .where(eq(ftsSearchSyncOutbox.documentId, claimed.documentId));
    expect(retried).toMatchObject({ attempts: 1, deadAt: null, lockedUntil: null });
    expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('bounds expired lease recovery to the requested claim limit', async () => {
    const documentIds = ['expired-agent-a', 'expired-agent-b', 'expired-agent-c'];
    await db.insert(agents).values(
      documentIds.map((id) => ({
        id,
        title: id,
        userId: USER_ID,
      })),
    );
    const claimed = await repository.claim(documentIds.length);
    expect(claimed).toHaveLength(documentIds.length);
    await db
      .update(ftsSearchSyncOutbox)
      .set({ lockedUntil: new Date(0) })
      .where(inArray(ftsSearchSyncOutbox.documentId, documentIds));

    await expect(repository.claim(1)).resolves.toEqual([]);
    const rows = await db
      .select({
        attempts: ftsSearchSyncOutbox.attempts,
        lockedUntil: ftsSearchSyncOutbox.lockedUntil,
      })
      .from(ftsSearchSyncOutbox)
      .where(inArray(ftsSearchSyncOutbox.documentId, documentIds));

    expect(rows.filter(({ lockedUntil }) => lockedUntil === null)).toHaveLength(1);
    expect(rows.map(({ attempts }) => attempts).toSorted()).toEqual([0, 0, 1]);
  });

  it(
    'fans knowledge-base relation changes out to files and linked documents',
    async () => {
      await db.execute(sql`
      INSERT INTO knowledge_bases (id, name, user_id)
      VALUES ('sync-kb', 'KB', ${USER_ID})
    `);
      await db.execute(sql`
      INSERT INTO files (id, user_id, file_type, name, size, url)
      VALUES ('sync-file', ${USER_ID}, 'text/plain', 'file.txt', 10, 'https://example.com/file')
    `);
      await db.execute(sql`
      INSERT INTO documents (
        id, file_type, total_char_count, total_line_count, source_type, source, file_id, user_id
      ) VALUES (
        'sync-document', 'text/plain', 10, 1, 'file', 'file.txt', 'sync-file', ${USER_ID}
      )
    `);
      await db.delete(ftsSearchSyncOutbox);

      await db.execute(sql`
      INSERT INTO knowledge_base_files (knowledge_base_id, file_id, user_id)
      VALUES ('sync-kb', 'sync-file', ${USER_ID})
    `);

      const rows = await db
        .select({ documentId: ftsSearchSyncOutbox.documentId, entity: ftsSearchSyncOutbox.entity })
        .from(ftsSearchSyncOutbox);
      const expectedKeys = await builder.resolveAffectedKeys({
        fileIds: ['sync-file'],
        relation: 'knowledgeBaseFiles',
      });
      expect(sortKeys(rows)).toEqual(
        sortKeys(expectedKeys.map(({ entity, id }) => ({ documentId: id, entity }))),
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          { documentId: 'sync-file', entity: 'files' },
          { documentId: 'sync-document', entity: 'documents' },
        ]),
      );
      expect(rows.every((row) => ['documents', 'files'].includes(row.entity))).toBe(true);

      await db.delete(ftsSearchSyncOutbox);
      await db.execute(sql`
      INSERT INTO knowledge_bases (id, name, user_id)
      VALUES ('sync-kb-next', 'Next KB', ${USER_ID})
    `);
      await db.execute(sql`
      UPDATE knowledge_base_files
      SET knowledge_base_id = 'sync-kb-next'
      WHERE knowledge_base_id = 'sync-kb' AND file_id = 'sync-file'
    `);
      const updatedRows = await db
        .select({ documentId: ftsSearchSyncOutbox.documentId, entity: ftsSearchSyncOutbox.entity })
        .from(ftsSearchSyncOutbox);
      expect(updatedRows).toEqual(
        expect.arrayContaining([
          { documentId: 'sync-file', entity: 'files' },
          { documentId: 'sync-document', entity: 'documents' },
        ]),
      );

      await db.delete(ftsSearchSyncOutbox);
      await db.execute(sql`
      DELETE FROM knowledge_base_files
      WHERE knowledge_base_id = 'sync-kb-next' AND file_id = 'sync-file'
    `);
      const removedRows = await db
        .select({ documentId: ftsSearchSyncOutbox.documentId, entity: ftsSearchSyncOutbox.entity })
        .from(ftsSearchSyncOutbox);
      expect(removedRows).toEqual(
        expect.arrayContaining([
          { documentId: 'sync-file', entity: 'files' },
          { documentId: 'sync-document', entity: 'documents' },
        ]),
      );
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it(
    'fans parent memory text changes out to derived memory projections',
    async () => {
      await db.execute(sql`
      INSERT INTO user_memories (id, user_id, title, last_accessed_at)
      VALUES ('sync-memory', ${USER_ID}, 'before', now())
    `);
      await db.execute(sql`
      INSERT INTO user_memories_contexts (id, user_id, user_memory_ids)
      VALUES ('sync-context', ${USER_ID}, '["sync-memory"]'::jsonb)
    `);
      await db.delete(ftsSearchSyncOutbox);

      await db.execute(sql`
      UPDATE user_memories SET title = 'after' WHERE id = 'sync-memory'
    `);

      const rows = await db
        .select({ documentId: ftsSearchSyncOutbox.documentId, entity: ftsSearchSyncOutbox.entity })
        .from(ftsSearchSyncOutbox);
      const expectedKeys = await builder.resolveAffectedKeys({
        memoryIds: ['sync-memory'],
        relation: 'userMemoryReferences',
      });
      expect(sortKeys(rows)).toEqual(
        sortKeys(expectedKeys.map(({ entity, id }) => ({ documentId: id, entity }))),
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          { documentId: 'sync-memory', entity: 'userMemories' },
          { documentId: 'sync-context', entity: 'memoryContexts' },
        ]),
      );

      await db.delete(ftsSearchSyncOutbox);
      await db.execute(sql`DELETE FROM user_memories WHERE id = 'sync-memory'`);
      const deletedRows = await db
        .select({ documentId: ftsSearchSyncOutbox.documentId, entity: ftsSearchSyncOutbox.entity })
        .from(ftsSearchSyncOutbox);
      expect(deletedRows).toEqual(
        expect.arrayContaining([
          { documentId: 'sync-memory', entity: 'userMemories' },
          { documentId: 'sync-context', entity: 'memoryContexts' },
        ]),
      );
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );
});

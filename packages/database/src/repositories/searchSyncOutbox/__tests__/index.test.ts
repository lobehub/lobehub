// @vitest-environment node
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, searchSyncOutbox, users } from '../../../schemas';
import { SearchDocumentBuilder } from '../../searchDocument';
import { SearchSyncOutboxRepository } from '..';
import {
  SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS,
  SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX,
} from '../captureInfrastructure';

const USER_ID = 'search-sync-integration-user';
const CAPTURE_INSTALL_TEST_TIMEOUT = 30_000;
const SEARCH_SYNC_TRIGGER_TARGETS = [
  { name: 'search_sync_agents', table: 'agents' },
  { name: 'search_sync_chat_groups', table: 'chat_groups' },
  { name: 'search_sync_documents', table: 'documents' },
  { name: 'search_sync_files', table: 'files' },
  { name: 'search_sync_knowledge_base_files', table: 'knowledge_base_files' },
  { name: 'search_sync_knowledge_bases', table: 'knowledge_bases' },
  { name: 'search_sync_memory_activities', table: 'user_memories_activities' },
  { name: 'search_sync_memory_contexts', table: 'user_memories_contexts' },
  { name: 'search_sync_memory_experiences', table: 'user_memories_experiences' },
  { name: 'search_sync_memory_identities', table: 'user_memories_identities' },
  { name: 'search_sync_memory_preferences', table: 'user_memories_preferences' },
  { name: 'search_sync_messages', table: 'messages' },
  { name: 'search_sync_persona_documents', table: 'user_memory_persona_documents' },
  { name: 'search_sync_topics', table: 'topics' },
  { name: 'search_sync_user_memories', table: 'user_memories' },
  { name: 'search_sync_user_memories_fanout', table: 'user_memories' },
] as const;
const SEARCH_SYNC_CAPTURE_FUNCTION_NAMES = [
  'capture_search_sync_change',
  'capture_search_sync_knowledge_base_files',
  'capture_search_sync_memory_fanout',
  'enqueue_search_sync_outbox',
] as const;

const db = await getTestDB();
const builder = new SearchDocumentBuilder(db);
const repository = new SearchSyncOutboxRepository(db);
let restoreCaptureInfrastructure = false;

const sortKeys = (keys: { documentId: string; entity: string }[]) =>
  keys.toSorted((left, right) =>
    `${left.entity}:${left.documentId}`.localeCompare(`${right.entity}:${right.documentId}`),
  );

const dropCaptureInfrastructure = async () => {
  for (const { name, table } of SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS) {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${name}" ON "${table}"`));
  }

  for (const functionName of SEARCH_SYNC_CAPTURE_FUNCTION_NAMES) {
    const signature =
      functionName === 'enqueue_search_sync_outbox' ? '(text, text[], smallint)' : '()';
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${functionName}"${signature}`));
  }
};

const hasCompleteCaptureInfrastructure = async () => {
  const triggerTargets = sql.join(
    SEARCH_SYNC_TRIGGER_TARGETS.map(
      ({ name, table }) => sql`(${name}, ${`public.${table}`}::regclass)`,
    ),
    sql`, `,
  );
  const functionNames = sql.join(
    SEARCH_SYNC_CAPTURE_FUNCTION_NAMES.map((name) => sql`${name}`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_index
        WHERE indexrelid = to_regclass(${`public.${SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX}`})
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
    Number(row.function_count) === SEARCH_SYNC_CAPTURE_FUNCTION_NAMES.length &&
    Number(row.trigger_count) === SEARCH_SYNC_TRIGGER_TARGETS.length &&
    Number(row.enabled_trigger_count) === SEARCH_SYNC_TRIGGER_TARGETS.length
  );
};

beforeAll(async () => {
  restoreCaptureInfrastructure = await hasCompleteCaptureInfrastructure();
  await dropCaptureInfrastructure();
}, CAPTURE_INSTALL_TEST_TIMEOUT);

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(searchSyncOutbox);
  await db.insert(users).values({ id: USER_ID });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(searchSyncOutbox);
  await dropCaptureInfrastructure();
  if (restoreCaptureInfrastructure) {
    await repository.installCaptureInfrastructure();
  }
}, CAPTURE_INSTALL_TEST_TIMEOUT);

describe.sequential('SearchSyncOutboxRepository', () => {
  it('keeps optional capture infrastructure out of the deployment migration', () => {
    const migration = readMigrationFiles({
      migrationsFolder: path.join(__dirname, '../../../../migrations'),
    }).find((item) =>
      item.sql.some(
        (statement) =>
          statement.includes('search_sync_revision_seq') &&
          statement.includes('search_sync_outbox'),
      ),
    );

    if (!migration) throw new Error('Search sync migration was not generated');
    const migrationSql = migration.sql.join('\n');

    expect(migrationSql).toContain('search_sync_revision_seq');
    expect(migrationSql).toContain('search_sync_outbox');
    expect(migrationSql).not.toContain('CREATE TRIGGER');
    expect(migrationSql).not.toContain('capture_search_sync_change');
    expect(migrationSql).not.toContain("set_config('lock_timeout', '3s', true)");
    expect(migrationSql).toContain(SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX);
    expect(migrationSql).not.toContain('search_sync_settings');
  });

  it('does not install capture infrastructure or enqueue ordinary writes by default', async () => {
    const triggerResult = await db.execute(sql`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname LIKE 'search_sync_%'
      ORDER BY tgname
    `);
    const triggerRows = Array.isArray(triggerResult) ? triggerResult : triggerResult.rows;
    expect(triggerRows).toEqual([]);

    const indexResult = await db.execute(sql`
      SELECT to_regclass(${`public.${SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX}`})::text AS index_name
    `);
    const indexRows = Array.isArray(indexResult) ? indexResult : indexResult.rows;
    expect(indexRows).toEqual([{ index_name: SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX }]);

    const functionResult = await db.execute(sql`
      SELECT proname
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (${sql.join(
          SEARCH_SYNC_CAPTURE_FUNCTION_NAMES.map((name) => sql`${name}`),
          sql`, `,
        )})
      ORDER BY proname
    `);
    const functionRows = Array.isArray(functionResult) ? functionResult : functionResult.rows;
    expect(functionRows).toEqual([]);

    await db.insert(agents).values({ id: 'base-agent', title: 'one', userId: USER_ID });
    await expect(db.select().from(searchSyncOutbox)).resolves.toEqual([]);
  });

  it('replays the outbox migration safely', async () => {
    const migration = readMigrationFiles({
      migrationsFolder: path.join(__dirname, '../../../../migrations'),
    }).find((item) =>
      item.sql.some(
        (statement) =>
          statement.includes('search_sync_revision_seq') &&
          statement.includes('search_sync_outbox'),
      ),
    );

    if (!migration) throw new Error('Search sync migration was not generated');
    for (const statement of migration.sql) await db.execute(sql.raw(statement));

    const outboxResult = await db.execute(
      sql`SELECT to_regclass('public.search_sync_outbox')::text AS table_name`,
    );
    const outboxRows = Array.isArray(outboxResult) ? outboxResult : outboxResult.rows;
    expect(outboxRows).toEqual([{ table_name: 'search_sync_outbox' }]);
  });

  it('indexes durable dead-letter checks', async () => {
    const result = await db.execute(sql`
      SELECT to_regclass('search_sync_outbox_dead_idx')::text AS index_name
    `);
    const rows = Array.isArray(result) ? result : result.rows;

    expect(rows).toEqual([{ index_name: 'search_sync_outbox_dead_idx' }]);
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
      WHERE NOT tgisinternal AND tgname LIKE 'search_sync_%'
        AND source_namespace.nspname = 'public'
      ORDER BY tgname
    `);
      const rows = Array.isArray(result) ? result : result.rows;

      expect(rows).toEqual(
        SEARCH_SYNC_TRIGGER_TARGETS.map(({ name: tgname, table: table_name }) => ({
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
      WHERE NOT tgisinternal AND tgname LIKE 'search_sync_%'
      ORDER BY tgname
    `);
      const firstRows = Array.isArray(firstResult) ? firstResult : firstResult.rows;

      await expect(repository.installCaptureInfrastructure()).resolves.toBeUndefined();

      const result = await db.execute(sql`
      SELECT oid::text, tgname
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname LIKE 'search_sync_%'
      ORDER BY tgname
    `);
      const rows = Array.isArray(result) ? result : result.rows;
      expect(rows).toEqual(firstRows);
      expect(rows).toHaveLength(16);
      await expect(repository.readCaptureFingerprint()).resolves.toMatch(/^[a-f\d]{64}$/);
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it('reserves and fences revisions for a local full-reindex checkpoint', async () => {
    const revision = await repository.reserveRevisionWithWriteFence();

    expect(revision).toBeGreaterThan(0);
    await expect(repository.readHighWaterRevision()).resolves.toBeGreaterThanOrEqual(revision);
  });

  it(
    'validates capture infrastructure and rejects a disabled trigger',
    async () => {
      await expect(repository.assertCaptureInfrastructure()).resolves.toBeUndefined();

      await db.execute(sql`ALTER TABLE agents DISABLE TRIGGER search_sync_agents`);
      try {
        await expect(repository.assertCaptureInfrastructure()).rejects.toThrow(
          'trigger search_sync_agents',
        );
        await expect(repository.installCaptureInfrastructure()).rejects.toThrow(
          'Refusing to replace partial or unknown search sync capture infrastructure',
        );
      } finally {
        await db.execute(sql`ALTER TABLE agents ENABLE TRIGGER search_sync_agents`);
      }

      await expect(repository.assertCaptureInfrastructure()).resolves.toBeUndefined();
    },
    CAPTURE_INSTALL_TEST_TIMEOUT,
  );

  it(
    'refuses to continue from a partial trigger installation',
    async () => {
      await db.execute(sql`DROP TRIGGER search_sync_agents ON agents`);
      try {
        await expect(repository.installCaptureInfrastructure()).rejects.toThrow(
          'Refusing to replace partial or unknown search sync capture infrastructure',
        );
        const result = await db.execute(sql`
        SELECT to_regclass('public.agents') IS NOT NULL AND EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'search_sync_agents' AND tgrelid = 'public.agents'::regclass
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
      CREATE OR REPLACE FUNCTION capture_search_sync_change() RETURNS trigger AS $$
      BEGIN
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `),
      );
      try {
        await expect(repository.assertCaptureInfrastructure()).rejects.toThrow(
          'function capture_search_sync_change',
        );
        await expect(repository.installCaptureInfrastructure()).rejects.toThrow(
          'Refusing to replace partial or unknown search sync capture infrastructure',
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
        .select({ documentId: searchSyncOutbox.documentId, entity: searchSyncOutbox.entity })
        .from(searchSyncOutbox),
    ).resolves.toEqual([{ documentId: 'immediate-agent', entity: 'agents' }]);
  });

  it('coalesces mutations and increases the revision, prioritizing revocations', async () => {
    await db.insert(agents).values({ id: 'sync-agent', title: 'one', userId: USER_ID });
    const [inserted] = await db
      .select()
      .from(searchSyncOutbox)
      .where(
        and(eq(searchSyncOutbox.entity, 'agents'), eq(searchSyncOutbox.documentId, 'sync-agent')),
      );

    await db
      .update(agents)
      .set({ title: 'two', visibility: 'private' })
      .where(eq(agents.id, 'sync-agent'));
    const rows = await db
      .select()
      .from(searchSyncOutbox)
      .where(
        and(eq(searchSyncOutbox.entity, 'agents'), eq(searchSyncOutbox.documentId, 'sync-agent')),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].revision).toBeGreaterThan(inserted.revision);
    expect(rows[0].priority).toBe(0);

    await db.delete(agents).where(eq(agents.id, 'sync-agent'));
    const [deleted] = await db
      .select()
      .from(searchSyncOutbox)
      .where(eq(searchSyncOutbox.documentId, 'sync-agent'));
    expect(deleted.revision).toBeGreaterThan(rows[0].revision);
    expect(deleted.priority).toBe(0);
  });

  it('does not enqueue an update that changes only an unprojected field', async () => {
    await db.insert(agents).values({ id: 'unprojected-agent', title: 'one', userId: USER_ID });
    await db.delete(searchSyncOutbox);

    await db.execute(sql`UPDATE agents SET pinned = true WHERE id = 'unprojected-agent'`);

    const rows = await db.select().from(searchSyncOutbox);
    expect(rows).toEqual([]);
  });

  it('enqueues an update that changes only the projected updated_at field', async () => {
    await db.insert(agents).values({ id: 'updated-at-agent', title: 'one', userId: USER_ID });
    await db.delete(searchSyncOutbox);

    await db
      .update(agents)
      .set({ updatedAt: new Date('2026-08-30T00:00:00.000Z') })
      .where(eq(agents.id, 'updated-at-agent'));

    await expect(
      db
        .select({ documentId: searchSyncOutbox.documentId, entity: searchSyncOutbox.entity })
        .from(searchSyncOutbox),
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
      .from(searchSyncOutbox)
      .where(eq(searchSyncOutbox.documentId, 'rolled-back-agent'));
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
      .from(searchSyncOutbox)
      .where(eq(searchSyncOutbox.documentId, first.documentId));
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
      .update(searchSyncOutbox)
      .set({ availableAt: new Date(0), lockedUntil: null })
      .where(eq(searchSyncOutbox.documentId, stale.documentId));
    const [current] = await repository.claim(1, 300);
    expect(current.leaseToken).not.toBe(stale.leaseToken);
    const [claimedRow] = await db
      .select()
      .from(searchSyncOutbox)
      .where(eq(searchSyncOutbox.documentId, current.documentId));

    await repository.releaseMany([stale]);
    await expect(
      db.select().from(searchSyncOutbox).where(eq(searchSyncOutbox.documentId, current.documentId)),
    ).resolves.toMatchObject([{ lockedUntil: claimedRow.lockedUntil }]);

    await repository.markFailures([
      { ...stale, error: new Error('late failure'), permanent: true },
    ]);
    await expect(
      db.select().from(searchSyncOutbox).where(eq(searchSyncOutbox.documentId, current.documentId)),
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
    await db.delete(searchSyncOutbox);
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
      .update(searchSyncOutbox)
      .set({ attempts: 35 })
      .where(eq(searchSyncOutbox.documentId, claimed.documentId));

    await expect(
      repository.markFailures([{ ...claimed, error: new Error('still failing') }]),
    ).resolves.toBe(1);
    await expect(repository.stats()).resolves.toMatchObject({ dead: 1, ready: 0 });
  });

  it('reaps expired leases into delayed retry without reclaiming them immediately', async () => {
    await db.insert(agents).values({ id: 'expired-agent', title: 'one', userId: USER_ID });
    const [claimed] = await repository.claim(1);
    await db
      .update(searchSyncOutbox)
      .set({ lockedUntil: new Date(0) })
      .where(eq(searchSyncOutbox.documentId, claimed.documentId));

    await expect(repository.stats()).resolves.toMatchObject({
      expiredLeases: 1,
      inFlight: 0,
      ready: 0,
    });
    await expect(repository.claim(1)).resolves.toEqual([]);
    const [retried] = await db
      .select()
      .from(searchSyncOutbox)
      .where(eq(searchSyncOutbox.documentId, claimed.documentId));
    expect(retried).toMatchObject({ attempts: 1, deadAt: null, lockedUntil: null });
    expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('fans knowledge-base relation changes out to files and linked documents', async () => {
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
    await db.delete(searchSyncOutbox);

    await db.execute(sql`
      INSERT INTO knowledge_base_files (knowledge_base_id, file_id, user_id)
      VALUES ('sync-kb', 'sync-file', ${USER_ID})
    `);

    const rows = await db
      .select({ documentId: searchSyncOutbox.documentId, entity: searchSyncOutbox.entity })
      .from(searchSyncOutbox);
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

    await db.delete(searchSyncOutbox);
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
      .select({ documentId: searchSyncOutbox.documentId, entity: searchSyncOutbox.entity })
      .from(searchSyncOutbox);
    expect(updatedRows).toEqual(
      expect.arrayContaining([
        { documentId: 'sync-file', entity: 'files' },
        { documentId: 'sync-document', entity: 'documents' },
      ]),
    );

    await db.delete(searchSyncOutbox);
    await db.execute(sql`
      DELETE FROM knowledge_base_files
      WHERE knowledge_base_id = 'sync-kb-next' AND file_id = 'sync-file'
    `);
    const removedRows = await db
      .select({ documentId: searchSyncOutbox.documentId, entity: searchSyncOutbox.entity })
      .from(searchSyncOutbox);
    expect(removedRows).toEqual(
      expect.arrayContaining([
        { documentId: 'sync-file', entity: 'files' },
        { documentId: 'sync-document', entity: 'documents' },
      ]),
    );
  });

  it('fans parent memory text changes out to derived memory projections', async () => {
    await db.execute(sql`
      INSERT INTO user_memories (id, user_id, title, last_accessed_at)
      VALUES ('sync-memory', ${USER_ID}, 'before', now())
    `);
    await db.execute(sql`
      INSERT INTO user_memories_contexts (id, user_id, user_memory_ids)
      VALUES ('sync-context', ${USER_ID}, '["sync-memory"]'::jsonb)
    `);
    await db.delete(searchSyncOutbox);

    await db.execute(sql`
      UPDATE user_memories SET title = 'after' WHERE id = 'sync-memory'
    `);

    const rows = await db
      .select({ documentId: searchSyncOutbox.documentId, entity: searchSyncOutbox.entity })
      .from(searchSyncOutbox);
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

    await db.delete(searchSyncOutbox);
    await db.execute(sql`DELETE FROM user_memories WHERE id = 'sync-memory'`);
    const deletedRows = await db
      .select({ documentId: searchSyncOutbox.documentId, entity: searchSyncOutbox.entity })
      .from(searchSyncOutbox);
    expect(deletedRows).toEqual(
      expect.arrayContaining([
        { documentId: 'sync-memory', entity: 'userMemories' },
        { documentId: 'sync-context', entity: 'memoryContexts' },
      ]),
    );
  });
});

// @vitest-environment node
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, searchSyncOutbox, searchSyncSettings, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { SearchDocumentBuilder } from '../../searchDocument';
import { SearchSyncOutboxRepository } from '..';

const USER_ID = 'search-sync-integration-user';
const isServerDB = process.env.TEST_SERVER_DB === '1';

const db = await getTestDB();
const builder = new SearchDocumentBuilder(db);
const repository = new SearchSyncOutboxRepository(db);

const sortKeys = (keys: { documentId: string; entity: string }[]) =>
  keys.toSorted((left, right) =>
    `${left.entity}:${left.documentId}`.localeCompare(`${right.entity}:${right.documentId}`),
  );

beforeAll(async () => {
  if (isServerDB) {
    await db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS user_memories_contexts_user_memory_ids_gin_idx
      ON user_memories_contexts USING gin (user_memory_ids)
    `);
    return;
  }

  /** PGlite does not support PostgreSQL's concurrent-index implementation. */
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS user_memories_contexts_user_memory_ids_gin_idx
    ON user_memories_contexts USING gin (user_memory_ids)
  `);
});

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(searchSyncOutbox);
  await repository.enableCapture();
  await db.insert(users).values({ id: USER_ID });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(searchSyncOutbox);
});

describe('SearchSyncOutboxRepository', () => {
  it('reserves and observes revisions for a local full-reindex checkpoint', async () => {
    const revision = await repository.reserveRevision();

    expect(revision).toBeGreaterThan(0);
    await expect(repository.readHighWaterRevision()).resolves.toBeGreaterThanOrEqual(revision);
  });

  it('replays the migration safely', async () => {
    const migration = readMigrationFiles({
      migrationsFolder: path.join(__dirname, '../../../../migrations'),
    }).find((item) =>
      item.sql.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS "search_sync_outbox"'),
      ),
    );

    if (!migration) throw new Error('Search sync migration was not generated');
    for (const statement of migration.sql) await db.execute(sql.raw(statement));
  });

  it('indexes durable dead-letter checks', async () => {
    const result = await db.execute(sql`
      SELECT to_regclass('search_sync_outbox_dead_idx')::text AS index_name
    `);
    const rows = Array.isArray(result) ? result : result.rows;

    expect(rows).toEqual([{ index_name: 'search_sync_outbox_dead_idx' }]);
  });

  it('keeps existing-table DDL out of the automatic deployment migration', () => {
    const migration = readMigrationFiles({
      migrationsFolder: path.join(__dirname, '../../../../migrations'),
    }).find((item) =>
      item.sql.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS "search_sync_outbox"'),
      ),
    );

    if (!migration) throw new Error('Search sync migration was not generated');
    const migrationSql = migration.sql.join('\n');

    expect(migrationSql).not.toContain('CREATE TRIGGER');
    expect(migrationSql).not.toContain('user_memories_contexts_user_memory_ids_gin_idx');
  });

  it('requires a valid GIN index and installs every capture trigger explicitly', async () => {
    const result = await db.execute(sql`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname LIKE 'search_sync_%'
      ORDER BY tgname
    `);
    const rows = Array.isArray(result) ? result : result.rows;

    expect(rows.map((row) => row.tgname)).toEqual([
      'search_sync_agents',
      'search_sync_chat_groups',
      'search_sync_documents',
      'search_sync_files',
      'search_sync_knowledge_base_files',
      'search_sync_knowledge_bases',
      'search_sync_memory_activities',
      'search_sync_memory_contexts',
      'search_sync_memory_experiences',
      'search_sync_memory_identities',
      'search_sync_memory_preferences',
      'search_sync_messages',
      'search_sync_persona_documents',
      'search_sync_topics',
      'search_sync_user_memories',
      'search_sync_user_memories_fanout',
    ]);

    const indexResult = await db.execute(sql`
      SELECT indisvalid AS is_valid
      FROM pg_index
      WHERE indexrelid = 'user_memories_contexts_user_memory_ids_gin_idx'::regclass
    `);
    const indexRows = Array.isArray(indexResult) ? indexResult : indexResult.rows;
    expect(indexRows).toEqual([{ is_valid: true }]);
  });

  it.each([{ indexRows: [] }, { indexRows: [{ is_valid: false }] }])(
    'refuses to enable capture when the required GIN index is missing or invalid',
    async ({ indexRows }) => {
      const execute = vi.fn().mockResolvedValueOnce(indexRows);
      const isolatedRepository = new SearchSyncOutboxRepository({
        execute: execute as LobeChatDatabase['execute'],
      });

      await expect(isolatedRepository.enableCapture()).rejects.toThrow(
        'A valid user_memories_contexts_user_memory_ids_gin_idx index is required',
      );
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps capture disabled when trigger installation fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ is_valid: true }])
      .mockRejectedValueOnce(new Error('lock timeout'));
    const isolatedRepository = new SearchSyncOutboxRepository({
      execute: execute as LobeChatDatabase['execute'],
    });

    await expect(isolatedRepository.enableCapture()).rejects.toThrow('lock timeout');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('keeps capture disabled unless a deployment explicitly enables it', async () => {
    await db
      .update(searchSyncSettings)
      .set({ enabled: false })
      .where(eq(searchSyncSettings.key, 'default'));
    await db.insert(agents).values({ id: 'disabled-agent', title: 'one', userId: USER_ID });
    await expect(db.select().from(searchSyncOutbox)).resolves.toEqual([]);

    await repository.enableCapture();
    await db.update(agents).set({ title: 'two' }).where(eq(agents.id, 'disabled-agent'));

    await expect(db.select().from(searchSyncOutbox)).resolves.toMatchObject([
      { documentId: 'disabled-agent', entity: 'agents' },
    ]);
  });

  it('reports and disables capture without deleting queued work', async () => {
    await db.insert(agents).values({ id: 'capture-agent', title: 'one', userId: USER_ID });
    await expect(repository.isCaptureEnabled()).resolves.toBe(true);

    await repository.disableCapture();

    await expect(repository.isCaptureEnabled()).resolves.toBe(false);
    await expect(db.select().from(searchSyncOutbox)).resolves.toHaveLength(1);
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

    await db.update(agents).set({ pinned: true }).where(eq(agents.id, 'unprojected-agent'));

    const rows = await db.select().from(searchSyncOutbox);
    expect(rows).toEqual([]);
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

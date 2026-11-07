// @vitest-environment node
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';

import journal from '../migrations/meta/_journal.json';
import { agentEvalMemories } from '../src/schemas/agentEvalMemory';
import { agentEvalEnvironments } from '../src/schemas/agentEvals';

const migrationsFolder = path.join(__dirname, '../migrations');
const migrationTag = '0205_lobe_bench_environments_and_memory';
const temporaryFolders: string[] = [];

async function canaryMigrationsFolder() {
  const folder = await mkdtemp(path.join(tmpdir(), 'lobe-bench-migration-'));
  temporaryFolders.push(folder);
  await mkdir(path.join(folder, 'meta'));
  const migrationIndex = journal.entries.findIndex(({ tag }) => tag === migrationTag);
  expect(migrationIndex).toBeGreaterThanOrEqual(0);
  const entries = journal.entries.slice(0, migrationIndex);
  await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  await Promise.all(
    entries.map(({ tag }) =>
      copyFile(path.join(migrationsFolder, `${tag}.sql`), path.join(folder, `${tag}.sql`)),
    ),
  );
  return folder;
}

const evidenceTables = [
  'agent_eval_datasets',
  'agent_eval_test_cases',
  'agent_eval_environments',
  'agent_eval_runs',
  'agent_eval_run_topics',
  'agent_eval_memories',
  'topics',
  'messages',
  'users',
];

async function evidence(client: PGlite) {
  return Promise.all(
    evidenceTables.map(
      async (table) =>
        (
          await client.query(
            `SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
    ),
  );
}

describe('LobeBench migration integration', () => {
  afterAll(async () => {
    await Promise.all(
      temporaryFolders.map((folder) => rm(folder, { recursive: true, force: true })),
    );
  });

  it('creates empty environment and memory tables with reusable links and preserves evidence on SQL replay', async () => {
    const client = new PGlite({ extensions: { vector } });
    const db = drizzle({ client });
    try {
      await migrate(db, { migrationsFolder });
      expect((await client.query('SELECT * FROM agent_eval_environments')).rows).toHaveLength(0);
      expect((await client.query('SELECT * FROM agent_eval_memories')).rows).toHaveLength(0);
      expect((await client.query('SELECT * FROM agent_eval_test_cases')).rows).toHaveLength(0);
      expect(
        (await client.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_search'")).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.query(
            "SELECT 1 FROM pg_indexes WHERE indexname = 'agent_eval_memories_bm25_idx'",
          )
        ).rows,
      ).toHaveLength(0);

      await client.exec(`
        INSERT INTO users (id) VALUES ('migration-user');
        INSERT INTO agent_eval_datasets (id, identifier, name)
          VALUES ('migration-dataset', 'saved-cases', 'Saved cases');
        INSERT INTO agent_eval_runs (id, dataset_id, user_id, status, metrics)
          VALUES ('migration-run', 'migration-dataset', 'migration-user', 'completed', '{"passedCases":1}');
        INSERT INTO topics (id, user_id) VALUES ('migration-topic', 'migration-user');
      `);
      const [environment] = await db
        .insert(agentEvalEnvironments)
        .values({ config: {}, name: 'Shared environment' })
        .returning();
      const [memory] = await db
        .insert(agentEvalMemories)
        .values({
          attemptId: 'migration-attempt',
          capturedAt: new Date('2026-10-20T00:00:00Z'),
          layer: 'identity',
          payload: { description: 'Saved evidence' },
          runId: 'migration-run',
          source: 'agent',
          topicId: 'migration-topic',
          userId: 'migration-user',
        })
        .returning();
      expect(environment.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
      expect(memory.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
      expect(memory.metadata).toBeNull();
      expect(memory.workspaceId).toBeNull();
      await client.query(
        `INSERT INTO agent_eval_test_cases (id, dataset_id, environment_id, content)
          VALUES ('migration-case-a', 'migration-dataset', $1, '{"input":"First case"}'),
                 ('migration-case-b', 'migration-dataset', $1, '{"input":"Second case"}')`,
        [environment.id],
      );
      await client.exec(`
        INSERT INTO messages (id, user_id, topic_id, role, content)
          VALUES ('migration-message', 'migration-user', 'migration-topic', 'assistant', 'Saved answer');
        INSERT INTO agent_eval_run_topics (run_id, topic_id, test_case_id, user_id, status, passed, eval_result)
          VALUES ('migration-run', 'migration-topic', 'migration-case-a', 'migration-user', 'passed', true,
            '{"reason":"Saved Judge reason","model":"frozen-judge"}');
      `);
      const before = await evidence(client);
      // SQL replay exercises idempotency independently of Drizzle's journal skip.
      const migrationIndex = journal.entries.findIndex(({ tag }) => tag === migrationTag);
      expect(migrationIndex).toBeGreaterThanOrEqual(0);
      for (const statement of readMigrationFiles({ migrationsFolder })[migrationIndex].sql) {
        await client.query(statement);
      }
      expect(await evidence(client)).toEqual(before);

      await client.query('DELETE FROM agent_eval_environments WHERE id = $1', [environment.id]);
      expect(
        (await client.query('SELECT environment_id FROM agent_eval_test_cases ORDER BY id')).rows,
      ).toEqual([{ environment_id: null }, { environment_id: null }]);
      expect((await client.query('SELECT * FROM agent_eval_run_topics')).rows).toHaveLength(1);
      await client.query("DELETE FROM agent_eval_runs WHERE id = 'migration-run'");
      expect((await client.query('SELECT * FROM agent_eval_memories')).rows).toHaveLength(0);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('retains Memory evidence after thread and topic deletion until its run is deleted', async () => {
    const client = new PGlite({ extensions: { vector } });
    const db = drizzle({ client });
    try {
      await migrate(db, { migrationsFolder });
      expect
        .soft(
          (
            await client.query(`
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'agent_eval_memories'
              AND column_name = 'topic_id'
          `)
          ).rows,
        )
        .toEqual([{ is_nullable: 'YES' }]);
      const indexedColumns = await client.query<{ column_name: string }>(`
        SELECT attribute.attname AS column_name
        FROM pg_index AS index
        JOIN pg_class AS table_class ON table_class.oid = index.indrelid
        JOIN pg_class AS index_class ON index_class.oid = index.indexrelid
        JOIN pg_am AS method ON method.oid = index_class.relam
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = table_class.oid AND attribute.attnum = index.indkey[0]
        WHERE table_class.oid = 'public.agent_eval_memories'::regclass
          AND method.amname = 'btree' AND index.indisvalid AND index.indisready
          AND index.indpred IS NULL
      `);
      expect
        .soft(indexedColumns.rows.map(({ column_name }) => column_name))
        .toEqual(expect.arrayContaining(['topic_id', 'thread_id', 'workspace_id']));

      await client.exec(`
        INSERT INTO users (id) VALUES ('retention-user');
        INSERT INTO agent_eval_datasets (id, identifier, name)
          VALUES ('retention-dataset', 'retention-cases', 'Retention cases');
        INSERT INTO agent_eval_runs (id, dataset_id, user_id, status)
          VALUES ('retention-run', 'retention-dataset', 'retention-user', 'completed'),
                 ('unrelated-run', 'retention-dataset', 'retention-user', 'completed');
        INSERT INTO topics (id, user_id)
          VALUES ('retention-topic', 'retention-user'), ('unrelated-topic', 'retention-user');
        INSERT INTO threads (id, topic_id, user_id, type)
          VALUES ('deleted-thread', 'retention-topic', 'retention-user', 'eval'),
                 ('cascaded-thread', 'retention-topic', 'retention-user', 'eval'),
                 ('unrelated-thread', 'unrelated-topic', 'retention-user', 'eval');
      `);
      const embedding = Array.from({ length: 1024 }, (_, index) => (index % 4) / 4);
      const retainedMemories = await db
        .insert(agentEvalMemories)
        .values(
          [null, 'deleted-thread', 'cascaded-thread'].map((threadId, index) => ({
            attemptId: `retention-run_retention-topic${threadId ? `_${threadId}` : ''}`,
            capturedAt: new Date('2026-10-20T00:00:00Z'),
            embedding,
            layer: 'identity' as const,
            payload: { description: 'Saved evidence', nested: { index, values: [1, 2, 3] } },
            runId: 'retention-run',
            source: 'agent' as const,
            threadId,
            topicId: 'retention-topic',
            userId: 'retention-user',
          })),
        )
        .returning();
      const [unrelatedMemory] = await db
        .insert(agentEvalMemories)
        .values({
          attemptId: 'unrelated-run_unrelated-topic_unrelated-thread',
          capturedAt: new Date('2026-10-21T00:00:00Z'),
          embedding,
          layer: 'identity',
          payload: { description: 'Other attempt evidence' },
          runId: 'unrelated-run',
          source: 'fixture',
          threadId: 'unrelated-thread',
          topicId: 'unrelated-topic',
          userId: 'retention-user',
        })
        .returning();
      const memories = () => db.select().from(agentEvalMemories).orderBy(agentEvalMemories.id);
      // Random uuid keys: compare in the same id order the query returns.
      const byId = <T extends { id: string }>(rows: T[]) =>
        [...rows].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

      await client.query("DELETE FROM threads WHERE id = 'deleted-thread'");
      expect.soft(await memories()).toEqual(
        byId([
          ...retainedMemories.map((memory) => ({
            ...memory,
            threadId: memory.threadId === 'deleted-thread' ? null : memory.threadId,
          })),
          unrelatedMemory,
        ]),
      );

      await client.query("DELETE FROM topics WHERE id = 'retention-topic'");
      expect
        .soft(
          (await client.query("SELECT id FROM threads WHERE topic_id = 'retention-topic'")).rows,
        )
        .toEqual([]);
      expect
        .soft(await memories())
        .toEqual(
          byId([
            ...retainedMemories.map((memory) => ({ ...memory, threadId: null, topicId: null })),
            unrelatedMemory,
          ]),
        );

      await client.query("DELETE FROM agent_eval_runs WHERE id = 'retention-run'");
      expect(await memories()).toEqual([unrelatedMemory]);
      expect((await client.query('SELECT id FROM agent_eval_runs ORDER BY id')).rows).toEqual([
        { id: 'unrelated-run' },
      ]);

      // A workspace run's Memory goes with its workspace; personal rows stay.
      await client.exec(`
        INSERT INTO workspaces (id, slug, name, primary_owner_id)
          VALUES ('retention-workspace', 'retention-workspace', 'Retention', 'retention-user');
      `);
      const [workspaceMemory] = await db
        .insert(agentEvalMemories)
        .values({
          attemptId: 'unrelated-run_unrelated-topic',
          capturedAt: new Date('2026-10-22T00:00:00Z'),
          layer: 'identity',
          payload: { description: 'Workspace attempt evidence' },
          runId: 'unrelated-run',
          source: 'agent',
          topicId: 'unrelated-topic',
          userId: 'retention-user',
          workspaceId: 'retention-workspace',
        })
        .returning();
      expect(await memories()).toEqual(byId([unrelatedMemory, workspaceMemory]));
      await client.query("DELETE FROM workspaces WHERE id = 'retention-workspace'");
      expect(await memories()).toEqual([unrelatedMemory]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('upgrades canary while retaining case IDs, ownership, answers and judged run records', async () => {
    const client = new PGlite({ extensions: { vector } });
    try {
      await migrate(drizzle({ client }), { migrationsFolder: await canaryMigrationsFolder() });
      await client.exec(`
        INSERT INTO users (id) VALUES ('existing-user');
        INSERT INTO agent_eval_datasets (id, identifier, name)
          VALUES ('existing-dataset', 'existing-cases', 'Existing dataset');
        INSERT INTO agent_eval_test_cases (id, user_id, dataset_id, content)
          VALUES ('existing-case', 'existing-user', 'existing-dataset', '{"input":"Existing"}');
        INSERT INTO agent_eval_runs (id, user_id, dataset_id, status, metrics)
          VALUES ('existing-run', 'existing-user', 'existing-dataset', 'completed', '{"passedCases":1}');
        INSERT INTO topics (id, user_id) VALUES ('existing-topic', 'existing-user');
        INSERT INTO messages (id, user_id, topic_id, role, content)
          VALUES ('existing-message', 'existing-user', 'existing-topic', 'assistant', 'Saved answer');
        INSERT INTO agent_eval_run_topics (run_id, topic_id, test_case_id, user_id, status, passed, eval_result)
          VALUES ('existing-run', 'existing-topic', 'existing-case', 'existing-user', 'passed', true,
            '{"reason":"Existing Judge reason"}');
      `);
      const preservedTables = ['agent_eval_runs', 'agent_eval_run_topics', 'topics', 'messages'];
      const before = await Promise.all(
        preservedTables.map(async (table) => (await client.query(`SELECT * FROM ${table}`)).rows),
      );
      await migrate(drizzle({ client }), { migrationsFolder });
      expect(
        await Promise.all(
          preservedTables.map(async (table) => (await client.query(`SELECT * FROM ${table}`)).rows),
        ),
      ).toEqual(before);
      expect(
        (
          await client.query(
            'SELECT id, user_id, environment_id, content FROM agent_eval_test_cases',
          )
        ).rows,
      ).toEqual([
        {
          content: { input: 'Existing' },
          environment_id: null,
          id: 'existing-case',
          user_id: 'existing-user',
        },
      ]);
    } finally {
      await client.close();
    }
  }, 60_000);
});

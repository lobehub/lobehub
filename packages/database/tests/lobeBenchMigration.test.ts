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
const migrationTag = '0199_lobe_bench_environments_and_memory';
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
      expect(environment.id).toMatch(/^[a-zA-Z0-9]{16}$/);
      expect(memory.id).toMatch(/^[a-zA-Z0-9]{16}$/);
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
      for (const statement of readMigrationFiles({ migrationsFolder }).at(-1)!.sql) {
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

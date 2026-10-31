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

import { upgradeLobeBenchDatabase } from '../../../scripts/upgradeLobeBenchDatabase/plan';
import journal from '../migrations/meta/_journal.json';
import legacyEntries from './fixtures/lobeBenchLegacy/journal.json';

const migrationsFolder = path.join(__dirname, '../migrations');
const legacyFolder = path.join(__dirname, 'fixtures/lobeBenchLegacy');
const temporaryFolders: string[] = [];

async function historicalFolder(legacy: boolean) {
  const folder = await mkdtemp(path.join(tmpdir(), 'lobe-bench-migration-'));
  temporaryFolders.push(folder);
  await mkdir(path.join(folder, 'meta'));
  const entries = legacy
    ? [...journal.entries.slice(0, 182), ...legacyEntries]
    : journal.entries.slice(0, -1);
  await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  await Promise.all(
    entries.map(({ idx, tag }) =>
      copyFile(
        path.join(legacy && idx >= 182 ? legacyFolder : migrationsFolder, `${tag}.sql`),
        path.join(folder, `${tag}.sql`),
      ),
    ),
  );
  return folder;
}

async function schema(client: PGlite) {
  return (
    await client.query(`SELECT table_name, column_name, is_nullable, data_type
    FROM information_schema.columns WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`)
  ).rows;
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

async function seedLegacyEvidence(client: PGlite) {
  await client.exec(`
    INSERT INTO users (id) VALUES ('migration-user');
    INSERT INTO agent_eval_datasets (id, identifier, name) VALUES ('migration-dataset', 'saved-cases', 'Saved cases');
    INSERT INTO agent_eval_environments (id, name, config) VALUES ('migration-env', 'System environment', '{}');
    INSERT INTO agent_eval_test_cases (id, dataset_id, environment_id, content)
      VALUES ('migration-case', 'migration-dataset', 'migration-env', '{"input":"Keep this case"}');
    INSERT INTO agent_eval_runs (id, dataset_id, user_id, status, metrics)
      VALUES ('migration-run', 'migration-dataset', 'migration-user', 'completed', '{"passedCases":1}');
    INSERT INTO topics (id, user_id) VALUES ('migration-topic', 'migration-user');
    INSERT INTO messages (id, user_id, topic_id, role, content)
      VALUES ('migration-message', 'migration-user', 'migration-topic', 'assistant', 'Saved answer');
    INSERT INTO agent_eval_run_topics (run_id, topic_id, test_case_id, user_id, status, passed, eval_result)
      VALUES ('migration-run', 'migration-topic', 'migration-case', 'migration-user', 'passed', true,
        '{"reason":"Saved Judge reason","model":"frozen-judge"}');
    INSERT INTO agent_eval_memories (id, user_id, run_id, topic_id, attempt_id, layer, source, payload, captured_at)
      VALUES ('migration-memory', 'migration-user', 'migration-run', 'migration-topic', 'migration-attempt',
        'identity', 'agent', '{"note":"Saved evidence"}', '2026-10-20T00:00:00Z');
  `);
}

describe('LobeBench migration integration', () => {
  afterAll(async () => {
    await Promise.all(
      temporaryFolders.map((folder) => rm(folder, { recursive: true, force: true })),
    );
  });

  it('replays from a fresh database with final nullable system ownership and no draft scopes', async () => {
    const client = new PGlite({ extensions: { vector } });
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
      const columns = await schema(client);
      expect(columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table_name: 'agent_eval_environments',
            column_name: 'user_id',
            is_nullable: 'YES',
          }),
          expect.objectContaining({
            table_name: 'agent_eval_test_cases',
            column_name: 'user_id',
            is_nullable: 'YES',
          }),
          expect.objectContaining({
            table_name: 'agent_eval_memories',
            column_name: 'payload',
            is_nullable: 'NO',
          }),
        ]),
      );
      expect(columns.some((row: any) => row.table_name === 'agent_eval_memory_scopes')).toBe(false);
      await seedLegacyEvidence(client);
      const before = await evidence(client);
      // SQL-level idempotency, separate from Drizzle's timestamp skip.
      for (const statement of readMigrationFiles({ migrationsFolder }).at(-1)!.sql) {
        await client.query(statement);
      }
      expect(await evidence(client)).toEqual(before);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('upgrades a canary database and keeps its existing cases and run records', async () => {
    const client = new PGlite({ extensions: { vector } });
    try {
      await migrate(drizzle({ client }), { migrationsFolder: await historicalFolder(false) });
      await client.exec(`INSERT INTO users (id) VALUES ('existing-user');
        INSERT INTO agent_eval_datasets (id, identifier, name) VALUES ('existing-dataset', 'existing-cases', 'Existing dataset');
        INSERT INTO agent_eval_test_cases (id, user_id, dataset_id, content)
          VALUES ('existing-case', 'existing-user', 'existing-dataset', '{"input":"Existing"}');
        INSERT INTO agent_eval_runs (id, user_id, dataset_id) VALUES ('existing-run', 'existing-user', 'existing-dataset');`);
      const before = (await client.query('SELECT * FROM agent_eval_runs')).rows;
      await migrate(drizzle({ client }), { migrationsFolder });
      expect((await client.query('SELECT * FROM agent_eval_runs')).rows).toEqual(before);
      expect(
        (await client.query("SELECT content FROM agent_eval_test_cases WHERE id = 'existing-case'"))
          .rows,
      ).toEqual([{ content: { input: 'Existing' } }]);
      expect(
        (
          await client.query(
            "SELECT environment_id FROM agent_eval_test_cases WHERE id = 'existing-case'",
          )
        ).rows,
      ).toEqual([{ environment_id: null }]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('diagnoses, atomically upgrades, and preserves all legacy evidence; unknown hashes are refused', async () => {
    const client = new PGlite({ extensions: { vector } });
    const fresh = new PGlite({ extensions: { vector } });
    try {
      await migrate(drizzle({ client }), { migrationsFolder: await historicalFolder(true) });
      await seedLegacyEvidence(client);
      const before = await evidence(client);
      const historyBefore = (
        await client.query<{ hash: string; id: number }>(
          'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows;
      expect(await upgradeLobeBenchDatabase(client, { apply: false, migrationsFolder })).toEqual({
        applied: false,
        kind: 'legacy',
        migrations: 17,
      });
      expect(await evidence(client)).toEqual(before);

      await client.query(
        "UPDATE drizzle.__drizzle_migrations SET hash = 'unknown' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)",
      );
      await expect(
        upgradeLobeBenchDatabase(client, { apply: true, migrationsFolder }),
      ).rejects.toThrow('Unknown migration history');
      await client.query('UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE id = $2', [
        historyBefore.at(-1)!.hash,
        historyBefore.at(-1)!.id,
      ]);

      // Fail after draft history removal to prove rollback covers both DDL and history.
      await expect(
        upgradeLobeBenchDatabase(
          {
            query: async (sql, params) => {
              if (sql.includes('CREATE TABLE') && sql.includes('channels'))
                throw new Error('injected DDL failure');
              return client.query(sql, params);
            },
          },
          { apply: true, migrationsFolder },
        ),
      ).rejects.toThrow('injected DDL failure');
      expect(
        (await client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows,
      ).toEqual(historyBefore);
      expect(await evidence(client)).toEqual(before);

      expect(await upgradeLobeBenchDatabase(client, { apply: true, migrationsFolder })).toEqual({
        applied: true,
        kind: 'legacy',
        migrations: 17,
      });
      expect(await evidence(client)).toEqual(before);
      await migrate(drizzle({ client: fresh }), { migrationsFolder });
      expect(await schema(client)).toEqual(await schema(fresh));
      expect(await upgradeLobeBenchDatabase(client, { apply: true, migrationsFolder })).toEqual({
        applied: false,
        kind: 'current',
        migrations: 0,
      });
      await migrate(drizzle({ client }), { migrationsFolder });
      expect(await evidence(client)).toEqual(before);
    } finally {
      await client.close();
      await fresh.close();
    }
  }, 60_000);
});

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

import {
  planLobeBenchUpgrade,
  upgradeLobeBenchDatabase,
} from '../../../scripts/upgradeLobeBenchDatabase/plan';
import journal from '../migrations/meta/_journal.json';
import legacyEntries from './fixtures/lobeBenchLegacy/journal.json';
import publishedEntries from './fixtures/lobeBenchPublished/journal.json';

const migrationsFolder = path.join(__dirname, '../migrations');
const legacyFolder = path.join(__dirname, 'fixtures/lobeBenchLegacy');
const publishedFolder = path.join(__dirname, 'fixtures/lobeBenchPublished');
const temporaryFolders: string[] = [];

async function historicalFolder(kind: 'canary' | 'legacy' | 'published') {
  const folder = await mkdtemp(path.join(tmpdir(), 'lobe-bench-migration-'));
  temporaryFolders.push(folder);
  await mkdir(path.join(folder, 'meta'));
  const entries =
    kind === 'legacy'
      ? [...journal.entries.slice(0, 182), ...legacyEntries]
      : kind === 'published'
        ? [...journal.entries.slice(0, 198), ...publishedEntries]
        : journal.entries.slice(0, -1);
  await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  await Promise.all(
    entries.map(({ idx, tag }) =>
      copyFile(
        path.join(
          kind === 'legacy' && idx >= 182
            ? legacyFolder
            : kind === 'published' && idx === 198
              ? publishedFolder
              : migrationsFolder,
          `${tag}.sql`,
        ),
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

async function expectGoalVisibility(client: PGlite) {
  expect(
    (
      await client.query(`SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'goals' AND column_name = 'visibility'`)
    ).rows,
  ).toEqual([{ column_default: expect.stringContaining("'public'"), is_nullable: 'NO' }]);
  const indexes = await client.query<{ indexdef: string }>(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'goals_workspace_visibility_idx'",
  );
  expect(indexes.rows).toHaveLength(1);
  expect(indexes.rows[0].indexdef).toContain('(workspace_id, visibility, user_id)');
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
  'goals',
];

async function evidence(client: PGlite) {
  return Promise.all(
    evidenceTables.map(
      async (table) =>
        (
          await client.query(
            `SELECT to_jsonb(t) ${table === 'goals' ? "- 'visibility'" : ''} AS value FROM ${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
    ),
  );
}

async function seedLegacyEvidence(client: PGlite) {
  await client.exec(`
    INSERT INTO users (id) VALUES ('migration-user');
    INSERT INTO goals (id, user_id, title) VALUES ('migration-goal', 'migration-user', 'Saved goal');
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
      await expectGoalVisibility(client);
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
      await migrate(drizzle({ client }), { migrationsFolder: await historicalFolder('canary') });
      await client.exec(`INSERT INTO users (id) VALUES ('existing-user');
        INSERT INTO agent_eval_datasets (id, identifier, name) VALUES ('existing-dataset', 'existing-cases', 'Existing dataset');
        INSERT INTO agent_eval_test_cases (id, user_id, dataset_id, content)
          VALUES ('existing-case', 'existing-user', 'existing-dataset', '{"input":"Existing"}');
        INSERT INTO agent_eval_runs (id, user_id, dataset_id) VALUES ('existing-run', 'existing-user', 'existing-dataset');
        INSERT INTO goals (id, user_id, title, visibility) VALUES ('existing-goal', 'existing-user', 'Private goal', 'private');`);
      const before = (await client.query('SELECT * FROM agent_eval_runs')).rows;
      await migrate(drizzle({ client }), { migrationsFolder });
      await expectGoalVisibility(client);
      expect(
        (await client.query("SELECT visibility FROM goals WHERE id = 'existing-goal'")).rows,
      ).toEqual([{ visibility: 'private' }]);
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
      await migrate(drizzle({ client }), { migrationsFolder: await historicalFolder('legacy') });
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
        migrations: 18,
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
              if (sql.includes('CREATE TABLE') && sql.includes('agent_eval_memories'))
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
        migrations: 18,
      });
      await expectGoalVisibility(client);
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

  it('normally migrates the exact published 0198 history without skipping goal visibility', async () => {
    const client = new PGlite({ extensions: { vector } });
    try {
      const published = await historicalFolder('published');
      const publishedMigration = readMigrationFiles({ migrationsFolder: published }).at(-1)!;
      expect(publishedMigration.folderMillis).toBe(1793442088212);
      expect(publishedMigration.hash).toBe(
        '3ae81e3241c84b47974a78b4fee2212ed788b35581b1a9d97b7397ee5c18d9d7',
      );
      expect(publishedMigration.folderMillis).toBeLessThan(journal.entries.at(-2)!.when);
      expect(journal.entries.at(-1)!.when).toBeGreaterThan(journal.entries.at(-2)!.when);
      await migrate(drizzle({ client }), { migrationsFolder: published });
      await seedLegacyEvidence(client);
      const before = await evidence(client);
      await migrate(drizzle({ client }), { migrationsFolder });
      await expectGoalVisibility(client);
      expect(await evidence(client)).toEqual(before);
      // Normal migration keeps the historical draft journal row; it does not canonicalize history.
      expect(
        (await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
          .rows,
      ).toEqual([{ count: journal.entries.length + 1 }]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('strictly diagnoses and atomically replaces the known published 0198 history', async () => {
    const client = new PGlite({ extensions: { vector } });
    const fresh = new PGlite({ extensions: { vector } });
    try {
      await migrate(drizzle({ client }), { migrationsFolder: await historicalFolder('published') });
      await seedLegacyEvidence(client);
      const before = await evidence(client);
      const beforeSchema = await schema(client);
      const historyBefore = (
        await client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')
      ).rows;
      expect(await upgradeLobeBenchDatabase(client, { apply: false, migrationsFolder })).toEqual({
        applied: false,
        kind: 'published',
        migrations: 2,
      });
      expect(await evidence(client)).toEqual(before);
      await expect(
        upgradeLobeBenchDatabase(
          {
            query: async (sql, params) => {
              if (sql.includes('CREATE TABLE') && sql.includes('agent_eval_memories'))
                throw new Error('injected failure after goal visibility');
              return client.query(sql, params);
            },
          },
          { apply: true, migrationsFolder },
        ),
      ).rejects.toThrow('injected failure after goal visibility');
      expect(await schema(client)).toEqual(beforeSchema);
      expect(
        (
          await client.query(
            "SELECT indexname FROM pg_indexes WHERE indexname = 'goals_workspace_visibility_idx'",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows,
      ).toEqual(historyBefore);
      expect(await evidence(client)).toEqual(before);
      expect(await upgradeLobeBenchDatabase(client, { apply: true, migrationsFolder })).toEqual({
        applied: true,
        kind: 'published',
        migrations: 2,
      });
      await expectGoalVisibility(client);
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

  it('refuses changed, partial, or extra published history without weakening the exact-prefix check', () => {
    const canonical = readMigrationFiles({ migrationsFolder }).map((entry) => ({
      created_at: entry.folderMillis,
      hash: entry.hash,
    }));
    const published = [
      ...canonical.slice(0, 198),
      {
        created_at: 1793442088212,
        hash: '3ae81e3241c84b47974a78b4fee2212ed788b35581b1a9d97b7397ee5c18d9d7',
      },
    ];
    for (const history of [
      published.slice(1),
      published.slice(0, -1),
      [...published, published[0]],
      published.map((entry, i) => (i === 198 ? { ...entry, hash: 'unknown' } : entry)),
      published.map((entry, i) =>
        i === 198 ? { ...entry, created_at: entry.created_at + 1 } : entry,
      ),
    ]) {
      expect(() => planLobeBenchUpgrade(history, migrationsFolder)).toThrow(
        'Unknown migration history',
      );
    }
  });
});

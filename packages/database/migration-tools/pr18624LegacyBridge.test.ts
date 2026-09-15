// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertPr18624SchemaShape,
  classifyPr18624History,
  PR18624_CANARY_BRIDGE_MIGRATIONS,
  PR18624_LEGACY_MIGRATIONS,
  type Pr18624BridgeDatabase,
  type Pr18624MigrationFile,
  type Pr18624MigrationRecord,
  runPr18624LegacyBridge,
} from './pr18624LegacyBridge';

const migrationsFolder = path.join(__dirname, '../migrations');
const archiveFolder = path.join(__dirname, '../migrations-archive/pr18624-legacy');
const journal = JSON.parse(
  readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
) as {
  entries: Array<{ idx: number; tag: string }>;
};
const migrationFiles = readMigrationFiles({ migrationsFolder });
const migrationByTag = new Map<string, (typeof migrationFiles)[number]>();
journal.entries.forEach((entry, index) => {
  const migration = migrationFiles[index];
  if (migration) migrationByTag.set(entry.tag, migration);
});

const bridgeFiles = PR18624_CANARY_BRIDGE_MIGRATIONS.map((entry) => {
  const migration = migrationByTag.get(entry.tag);
  if (!migration) throw new Error(`Missing canary migration ${entry.tag}`);
  return { ...migration, tag: entry.tag } as Pr18624MigrationFile;
});
const knownLaterMigrations = journal.entries.flatMap((entry, index) => {
  const migration = migrationFiles[index];
  return entry.idx >= 162 && migration
    ? [{ sha256: migration.hash, when: migration.folderMillis }]
    : [];
});
const legacyRecords = PR18624_LEGACY_MIGRATIONS.map((migration) => ({
  created_at: migration.when,
  hash: migration.sha256,
}));
const legacy154Variants = [
  {
    file: '0154_document_rewrite_sessions.sql',
    hash: 'b227a7e7eb2236a2381635df0931501030126bfb1b80165fc21db2159be82cb1',
  },
  {
    file: '0154_document_rewrite_sessions.executed.sql',
    hash: '0abee247c0b878356b1f169baeb693ebbaececbcff2e0c9a204e733cdd5fc2cc',
  },
] as const;
type Legacy154Variant = (typeof legacy154Variants)[number];
const clients: PGlite[] = [];
const newClient = () => {
  const client = new PGlite({ extensions: { vector } });
  clients.push(client);
  return client;
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

const execute = async (client: PGlite, statement: string): Promise<void> => {
  // PGlite does not ship the production pg_search extension. The real-driver
  // ParadeDB/Postgres replay remains a separate deployment-level gate.
  if (/pg_search|bm25/i.test(statement)) return;
  await client.exec(statement);
};

const ensureMigrationTable = async (client: PGlite): Promise<void> => {
  await client.exec('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.exec(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
};

const insertMigration = async (
  client: PGlite,
  migration: { hash: string; folderMillis: number },
): Promise<void> => {
  await client.exec(
    `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ('${migration.hash}', ${migration.folderMillis})`,
  );
};

const runFiles = async (
  client: PGlite,
  files: Array<{ hash: string; folderMillis: number; sql: string[] }>,
): Promise<void> => {
  for (const migration of files) {
    for (const statement of migration.sql) await execute(client, statement);
    await insertMigration(client, migration);
  }
};

const runRunnerFromLatest = async (client: PGlite): Promise<void> => {
  const rows = await client.query<{ created_at: string }>(
    'SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
  );
  const latest = Number(rows.rows[0]?.created_at ?? 0);
  const ordered = migrationFiles.map((migration, index) => ({
    ...migration,
    tag: journal.entries[index]?.tag ?? '',
  }));
  for (const migration of ordered) {
    if (latest >= migration.folderMillis) continue;
    for (const statement of migration.sql) await execute(client, statement);
    await insertMigration(client, migration);
  }
};

const dbFor = (client: PGlite): Pr18624BridgeDatabase => {
  const database = pgliteDrizzle({ client });
  return {
    execute: (query) => database.execute(query as Parameters<typeof database.execute>[0]),
    transaction: async (callback) =>
      database.transaction(async (transaction) =>
        callback({
          execute: (query) =>
            transaction.execute(query as Parameters<typeof transaction.execute>[0]),
        }),
      ),
  };
};

const records = async (client: PGlite): Promise<Pr18624MigrationRecord[]> => {
  const result = await client.query<{ hash: string; created_at: string }>(
    'SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC',
  );
  return result.rows;
};

const seedDocument = async (client: PGlite): Promise<void> => {
  await client.exec(`
    INSERT INTO users (id, email, email_verified, last_active_at)
    VALUES ('bridge-user', 'bridge@example.test', true, now());
    INSERT INTO documents (
      id, file_type, total_char_count, total_line_count, source_type, source, user_id
    ) VALUES ('bridge-document', 'document', 0, 0, 'api', 'bridge-test', 'bridge-user');
  `);
};

const seedLegacyRows = async (client: PGlite): Promise<void> => {
  await seedDocument(client);
  await client.exec(`
    INSERT INTO document_annotations (id, document_id, user_id, quoted_text)
    VALUES ('legacy-annotation', 'bridge-document', 'bridge-user', 'sentinel');
    INSERT INTO document_collaboration_states (
      document_id, room_id, user_id, version_token, document_updated_at
    ) VALUES ('bridge-document', 'legacy-room', 'bridge-user', 'legacy-token', now());
    INSERT INTO document_rewrite_requests (
      id, document_id, requested_by_user_id, agent_id, instruction, selection,
      target_node_ids, session_id, turn_index
    ) VALUES (
      'legacy-request', 'bridge-document', 'bridge-user', 'bridge-agent', 'sentinel',
      '{"kind":"relative","quotedText":"","quotedTextHash":"sentinel"}', '{}',
      'legacy-session', 1
    );
    INSERT INTO document_histories (
      id, document_id, user_id, editor_data, save_source, saved_at, request_id, source
    ) VALUES (
      'legacy-history', 'bridge-document', 'bridge-user', '{}', 'system', now(),
      'legacy-request', 'bridge-test'
    );
  `);
};

const runLegacySql = async (
  client: PGlite,
  legacy154Variant: Legacy154Variant = legacy154Variants[0],
): Promise<void> => {
  const entries = PR18624_LEGACY_MIGRATIONS.map((entry) => ({
    ...entry,
    sql: (() => {
      const filename = entry.idx === 154 ? legacy154Variant.file : `${entry.tag}.sql`;
      const expectedHash = entry.idx === 154 ? legacy154Variant.hash : entry.sha256;
      const source = readFileSync(path.join(archiveFolder, filename), 'utf8');
      expect(createHash('sha256').update(source).digest('hex')).toBe(expectedHash);
      return source.split('--> statement-breakpoint').filter(Boolean);
    })(),
    folderMillis: entry.when,
    hash: entry.idx === 154 ? legacy154Variant.hash : entry.sha256,
  }));
  await runFiles(client, entries);
};

describe('PR18624 legacy migration bridge', () => {
  it('keeps both archived 0154 variants byte-identical to their manifest', () => {
    for (const entry of PR18624_LEGACY_MIGRATIONS) {
      const source = readFileSync(path.join(archiveFolder, `${entry.tag}.sql`), 'utf8');
      expect(createHash('sha256').update(source).digest('hex')).toBe(entry.sha256);
    }
    for (const variant of legacy154Variants) {
      const source = readFileSync(path.join(archiveFolder, variant.file), 'utf8');
      expect(createHash('sha256').update(source).digest('hex')).toBe(variant.hash);
    }
  });

  it('rejects clean, partial, and tampered histories', () => {
    expect(classifyPr18624History([])).toBe('clean');
    expect(() => classifyPr18624History(legacyRecords.slice(0, 8))).toThrow('partial');
    expect(() =>
      classifyPr18624History(
        legacyRecords.map((migration, index) =>
          index === 0 ? { created_at: migration.created_at, hash: 'tampered' } : migration,
        ),
      ),
    ).toThrow('partial');
    expect(() =>
      classifyPr18624History([
        ...legacyRecords,
        { created_at: 1789100000000, hash: 'unknown-later-migration' },
      ]),
    ).toThrow('unknown later');
    expect(
      classifyPr18624History(
        legacyRecords.map((migration, index) =>
          index === 5 ? { ...migration, hash: legacy154Variants[1].hash } : migration,
        ),
      ),
    ).toBe('legacy');
    expect(() =>
      classifyPr18624History(
        legacyRecords.map((migration, index) =>
          index === 5 ? { ...migration, hash: 'unknown-0154' } : migration,
        ),
      ),
    ).toThrow('partial');
  });

  it('replays the clean migration-file set and keeps the bridge append-only', async () => {
    const client = newClient();
    await ensureMigrationTable(client);
    await runFiles(client, migrationFiles);
    await assertPr18624SchemaShape(dbFor(client));
    const migrationRows = await records(client);
    expect(migrationRows).toHaveLength(164);
    expect(Number(migrationRows.at(-1)?.created_at)).toBe(migrationFiles.at(-1)?.folderMillis);
  });

  it('keeps the upstream 0162 migration before the unpublished PR18624 0163 tail', () => {
    expect(journal.entries.slice(-2).map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      {
        idx: 162,
        tag: '0162_fts_capture_version',
      },
      {
        idx: 163,
        tag: '0163_pr18624_document_rewrite_collaboration',
      },
    ]);

    const upstream = migrationByTag.get('0162_fts_capture_version');
    const collaboration = migrationByTag.get('0163_pr18624_document_rewrite_collaboration');
    expect(upstream).toMatchObject({
      folderMillis: 1789308031904,
      hash: '3f50b93831233585bc59de911d5a21cac062d365f43a5b7374748ca081bd5a4d',
    });
    expect(collaboration).toMatchObject({
      folderMillis: 1789356957683,
      hash: '1d82067ef304d1e6bf33a4c50cdc5496e91a1e4f87aea03f60c8e3ec56b44d18',
    });
  });

  it.each(legacy154Variants)(
    'bridges the legacy lineage with the $file variant before the runner, twice, without losing sentinels',
    async (legacy154Variant) => {
      const client = newClient();
      await ensureMigrationTable(client);
      const base = migrationFiles.slice(0, 149);
      await runFiles(client, base);
      await runLegacySql(client, legacy154Variant);
      await seedLegacyRows(client);

      const database = dbFor(client);
      await runPr18624LegacyBridge(database, bridgeFiles, knownLaterMigrations);
      const afterBridge = await records(client);
      expect(afterBridge).toHaveLength(168);
      expect(Number(afterBridge.at(-1)?.created_at)).toBe(PR18624_LEGACY_MIGRATIONS.at(-1)?.when);
      await runPr18624LegacyBridge(database, bridgeFiles, knownLaterMigrations);
      expect(await records(client)).toHaveLength(afterBridge.length);

      await runRunnerFromLatest(client);
      const afterRunner = await records(client);
      expect(afterRunner).toHaveLength(173);
      await runPr18624LegacyBridge(database, bridgeFiles, knownLaterMigrations);
      expect(await records(client)).toHaveLength(afterRunner.length);
      await assertPr18624SchemaShape(database);
      const sentinel = await client.query<{ id: string }>(
        `SELECT id FROM document_rewrite_requests WHERE id = 'legacy-request'`,
      );
      expect(sentinel.rows).toEqual([{ id: 'legacy-request' }]);
      expect(
        (await client.query(`SELECT id FROM document_annotations WHERE id = 'legacy-annotation'`))
          .rows,
      ).toEqual([{ id: 'legacy-annotation' }]);
      expect(
        (
          await client.query(
            `SELECT document_id FROM document_collaboration_states WHERE document_id = 'bridge-document'`,
          )
        ).rows,
      ).toEqual([{ document_id: 'bridge-document' }]);
      expect(
        (await client.query(`SELECT id FROM document_histories WHERE id = 'legacy-history'`)).rows,
      ).toEqual([{ id: 'legacy-history' }]);
      expect((await records(client)).some((row) => row.hash === bridgeFiles[0]?.hash)).toBe(true);

      await client.exec(
        `ALTER TABLE document_annotations ALTER COLUMN quoted_text TYPE varchar(255) USING quoted_text::varchar`,
      );
      await expect(assertPr18624SchemaShape(database)).rejects.toThrow('wrong columns');
      await client.exec(
        `ALTER TABLE document_annotations ALTER COLUMN quoted_text TYPE text USING quoted_text::text`,
      );
      await client.exec(
        `ALTER TABLE document_annotations DROP CONSTRAINT document_annotations_document_id_documents_id_fk`,
      );
      await expect(assertPr18624SchemaShape(database)).rejects.toThrow('wrong foreign keys');
    },
  );
});

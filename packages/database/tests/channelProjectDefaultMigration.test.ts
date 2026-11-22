// @vitest-environment node
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import journal from '../migrations/meta/_journal.json';

const migrationsFolder = path.join(__dirname, '../migrations');
const TAG = '0227_channel_project_default_mark';

const readMetadata = async (client: PGlite) =>
  Object.fromEntries(
    (
      await client.query<{ id: string; metadata: Record<string, unknown> | null }>(
        'SELECT id, metadata FROM channels ORDER BY id',
      )
    ).rows.map(({ id, metadata }) => [id, metadata]),
  );

describe('marking existing projects’ default Channels', () => {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client });
  let historicalFolder: string;

  beforeAll(async () => {
    historicalFolder = await mkdtemp(
      path.join(tmpdir(), 'lobe-channel-project-default-migration-'),
    );
    await mkdir(path.join(historicalFolder, 'meta'));
    const last = journal.entries.findIndex(({ tag }) => tag === TAG);
    const entries = journal.entries.slice(0, last);
    await Promise.all([
      writeFile(
        path.join(historicalFolder, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries }),
      ),
      ...entries.map(({ tag }) =>
        copyFile(
          path.join(migrationsFolder, `${tag}.sql`),
          path.join(historicalFolder, `${tag}.sql`),
        ),
      ),
    ]);
    await migrate(db, { migrationsFolder: historicalFolder });
    await client.query(`INSERT INTO users (id) VALUES ('u_owner'), ('u_peer')`);
    await client.query(
      `INSERT INTO projects (id, name, user_id)
       VALUES ('pro_a', 'A', 'u_owner'), ('pro_b', 'B', 'u_owner'),
              ('pro_c', 'C', 'u_owner'), ('pro_d', 'D', 'u_owner')`,
    );
    await client.query(
      `INSERT INTO channels
         (id, title, project_id, peer_user_id, metadata, is_deleted, deleted_at, created_at, updated_at)
       VALUES
         -- The oldest General Channel of a project; a later one keeps its metadata.
         ('chn_a1', 'General', 'pro_a', NULL, NULL, NULL, NULL, '2026-01-01', now()),
         ('chn_a2', 'General', 'pro_a', NULL, '{}', NULL, NULL, '2026-01-02', now()),
         -- A renamed default Channel stays unmarked, and so does a later General.
         ('chn_b1', 'Lobby', 'pro_b', NULL, '{}', NULL, NULL, '2026-01-01', now()),
         ('chn_b2', 'General', 'pro_b', NULL, '{}', NULL, NULL, '2026-01-02', now()),
         -- A trashed Channel is passed over; the mark merges into existing metadata.
         ('chn_c0', 'General', 'pro_c', NULL, '{}', true, now(), '2026-01-01', now()),
         ('chn_c1', 'General', 'pro_c', NULL, '{"note": 1}', NULL, NULL, '2026-01-02', now()),
         -- A conversation between two people is no group Channel.
         ('chn_d0', 'General', 'pro_d', 'u_peer', '{}', NULL, NULL, '2026-01-01', now()),
         ('chn_d1', 'General', 'pro_d', NULL, '{}', NULL, NULL, '2026-01-02', now()),
         -- A workspace Channel belongs to no project.
         ('chn_w', 'General', NULL, NULL, '{}', NULL, NULL, '2026-01-01', now())`,
    );
    await migrate(db, { migrationsFolder });
  }, 30_000);

  afterAll(async () => {
    await client.close();
    if (historicalFolder) await rm(historicalFolder, { force: true, recursive: true });
  });

  it("marks each project's oldest live group Channel still titled General", async () => {
    expect(await readMetadata(client)).toEqual({
      chn_a1: { projectDefault: true },
      chn_a2: {},
      chn_b1: {},
      chn_b2: {},
      chn_c0: {},
      chn_c1: { note: 1, projectDefault: true },
      chn_d0: {},
      chn_d1: { projectDefault: true },
      chn_w: {},
    });
  });

  it('replays without changing anything', async () => {
    const before = await readMetadata(client);
    const entry = journal.entries.find(({ tag }) => tag === TAG);
    const migration = readMigrationFiles({ migrationsFolder }).find(
      ({ folderMillis }) => folderMillis === entry?.when,
    );
    if (!migration) throw new Error('Channel project-default migration not found');
    await db.transaction(async (tx) => {
      for (const statement of migration.sql) await tx.execute(statement);
    });
    expect(await readMetadata(client)).toEqual(before);
  });
});

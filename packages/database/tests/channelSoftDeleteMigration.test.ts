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
const TAG = '0189_channel_soft_delete';

const readChannels = async (client: PGlite) =>
  (
    await client.query<{ deleted_at: Date | null; id: string; is_deleted: boolean | null }>(
      'SELECT id, is_deleted, deleted_at FROM channels ORDER BY id',
    )
  ).rows;

describe('Channel soft-delete upgrade from the archived flag', () => {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client });
  const archivedAt = new Date('2026-10-01T00:00:00.000Z');
  let historicalFolder: string;

  beforeAll(async () => {
    historicalFolder = await mkdtemp(path.join(tmpdir(), 'lobe-channel-soft-delete-migration-'));
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
    await client.query(
      `INSERT INTO channels (id, title, archived, updated_at)
       VALUES ('chn_live', 'Live', false, now()), ('chn_removed', 'Removed', true, $1)`,
      [archivedAt],
    );
    await migrate(db, { migrationsFolder });
  }, 30_000);

  afterAll(async () => {
    await client.close();
    if (historicalFolder) await rm(historicalFolder, { force: true, recursive: true });
  });

  it('keeps removed channels deleted and live channels live', async () => {
    expect(await readChannels(client)).toEqual([
      { deleted_at: null, id: 'chn_live', is_deleted: null },
      { deleted_at: archivedAt, id: 'chn_removed', is_deleted: true },
    ]);
    const columns = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'channels' AND column_name = 'archived'`,
    );
    expect(columns.rows).toHaveLength(0);
  });

  it('replays safely once the archived flag is gone', async () => {
    const before = await readChannels(client);
    const entry = journal.entries.find(({ tag }) => tag === TAG);
    const migration = readMigrationFiles({ migrationsFolder }).find(
      ({ folderMillis }) => folderMillis === entry?.when,
    );
    if (!migration) throw new Error('Channel soft-delete migration not found');
    await db.transaction(async (tx) => {
      for (const statement of migration.sql) await tx.execute(statement);
    });
    expect(await readChannels(client)).toEqual(before);
  });
});

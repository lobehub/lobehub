import { readFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import type * as PGliteMigrator from 'drizzle-orm/pglite/migrator';
import { migrate as pgliteMigrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from './getTestDB';
import {
  createPGlite,
  migrationsFolder,
  PGLITE_SNAPSHOT_ENV,
  readPGliteSnapshot,
} from './pgliteSnapshot';

vi.mock('drizzle-orm/pglite/migrator', async (importOriginal) => ({
  ...(await importOriginal<typeof PGliteMigrator>()),
  migrate: vi.fn(),
}));

const journal = JSON.parse(
  readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
) as {
  entries: unknown[];
};

const tableExists = async (pglite: ReturnType<typeof createPGlite>, table: string) => {
  const { rows } = await pglite.query<{ exists: boolean }>(
    `select to_regclass($1) is not null as "exists"`,
    [table],
  );
  return rows[0].exists;
};

// Server DB mode migrates a real Postgres and never uses the PGlite snapshot.
describe.skipIf(process.env.TEST_SERVER_DB === '1')('PGlite migration snapshot', () => {
  it('is provided by the global setup with every migration applied', async () => {
    expect(process.env[PGLITE_SNAPSHOT_ENV]).toBeTruthy();

    const pglite = createPGlite(readPGliteSnapshot());
    try {
      const { rows } = await pglite.query<{ count: number }>(
        'select count(*)::int as count from drizzle.__drizzle_migrations',
      );
      expect(rows[0].count).toBe(journal.entries.length);
    } finally {
      await pglite.close();
    }
  });

  it('getTestDB restores the snapshot instead of rerunning migrations', async () => {
    const db = await getTestDB();

    // Compare the count: printing the mock's drizzle-client arguments on failure exhausts the heap.
    expect(vi.mocked(pgliteMigrate).mock.calls.length).toBe(0);
    const { rows } = await db.execute<{ exists: boolean }>(
      sql`select to_regclass('public.users') is not null as "exists"`,
    );
    expect(rows[0].exists).toBe(true);
  });

  it('restores independent databases from the same snapshot', async () => {
    const snapshot = readPGliteSnapshot();
    const first = createPGlite(snapshot);
    const second = createPGlite(snapshot);

    try {
      await first.exec('create table snapshot_isolation_probe (id int)');

      expect(await tableExists(first, 'snapshot_isolation_probe')).toBe(true);
      expect(await tableExists(second, 'snapshot_isolation_probe')).toBe(false);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});

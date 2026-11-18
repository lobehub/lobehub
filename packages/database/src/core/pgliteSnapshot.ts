import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { migrate as pgliteMigrate } from 'drizzle-orm/pglite/migrator';

/**
 * Env var holding the path of a fully migrated PGlite data dir dump.
 *
 * Set by `tests/pgliteSnapshot.globalSetup.ts` once per Vitest run and read by
 * `getTestDB()` in every test file. Test files are isolated, so without the
 * snapshot each file re-ran all migrations (~1.7s uncontended); under CI CPU
 * contention that first `getTestDB()` call intermittently exceeded the 10s
 * hook timeout. Restoring the dump takes ~0.2s.
 */
export const PGLITE_SNAPSHOT_ENV = 'LOBE_TEST_PGLITE_SNAPSHOT';

export const migrationsFolder = join(__dirname, '../../migrations');

export const createPGlite = (loadDataDir?: Blob) =>
  new PGlite({ extensions: { vector }, loadDataDir });

/**
 * Run every migration on a fresh PGlite instance and write its data dir dump to `filePath`.
 */
export const writeMigratedPGliteSnapshot = async (filePath: string) => {
  const pglite = createPGlite();

  try {
    // pg_search migrations skip themselves when the extension is unavailable, as in PGlite.
    await pgliteMigrate(pgliteDrizzle({ client: pglite }), { migrationsFolder });
    const dump = await pglite.dumpDataDir('none');
    await writeFile(filePath, Buffer.from(await dump.arrayBuffer()));
  } finally {
    await pglite.close();
  }
};

/**
 * Read the snapshot announced by the global setup, or `undefined` when the
 * current run has none (e.g. a Vitest config without the global setup).
 */
export const readPGliteSnapshot = (): Blob | undefined => {
  const filePath = process.env[PGLITE_SNAPSHOT_ENV];
  if (!filePath) return;

  return new Blob([readFileSync(filePath)]);
};

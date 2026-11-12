import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGLITE_SNAPSHOT_ENV, writeMigratedPGliteSnapshot } from '../src/core/pgliteSnapshot';

/**
 * Migrate a PGlite database once per Vitest run so `getTestDB()` can restore it
 * in each test file instead of re-running every migration. Workers inherit the
 * env var because they are spawned after global setup.
 *
 * Watch mode keeps the snapshot from startup: restart Vitest after editing a migration.
 */
export default async function setup() {
  // Server DB mode migrates a real Postgres once per worker already.
  if (process.env.TEST_SERVER_DB === '1') return;

  // Global setup runs once per project; the root config's `app` and `server`
  // projects share the snapshot built by whichever runs first.
  const existing = process.env[PGLITE_SNAPSHOT_ENV];
  if (existing && existsSync(existing)) return;

  const filePath = join(tmpdir(), `lobe-pglite-snapshot-${process.pid}.tar`);
  await writeMigratedPGliteSnapshot(filePath);
  process.env[PGLITE_SNAPSHOT_ENV] = filePath;

  return async () => {
    delete process.env[PGLITE_SNAPSHOT_ENV];
    await rm(filePath, { force: true });
  };
}

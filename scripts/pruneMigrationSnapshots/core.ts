import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * drizzle-kit only diffs against the newest snapshot and runtime migrations read
 * `_journal.json` + SQL, so older snapshots are dead weight. A few recent ones are
 * kept so a draft migration can still be dropped and regenerated.
 */
export const DEFAULT_KEEP_SNAPSHOTS = 10;

const SNAPSHOT_FILE = /^\d+_snapshot\.json$/;

export const pruneMigrationSnapshots = (metaDir: string, keep = DEFAULT_KEEP_SNAPSHOTS) => {
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer`);

  const snapshots = readdirSync(metaDir)
    .filter((file) => SNAPSHOT_FILE.test(file))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  const removed = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const file of removed) rmSync(path.join(metaDir, file));

  return removed;
};

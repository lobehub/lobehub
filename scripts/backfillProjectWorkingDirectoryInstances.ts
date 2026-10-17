/**
 * Backfill legacy project_working_directories rows into the environment model,
 * so they resolve through an environment instance linked to their project.
 * See backfillProjectWorkingDirectoryInstancesCore.ts for the upgrade rules.
 *
 * Dry-run by default; pass --apply to write. Idempotent and resumable.
 *
 *   bunx tsx scripts/backfillProjectWorkingDirectoryInstances.ts
 *   bunx tsx scripts/backfillProjectWorkingDirectoryInstances.ts --apply --batch-size=100
 */
import pg from 'pg';

import { backfillProjectWorkingDirectoryInstances } from './backfillProjectWorkingDirectoryInstancesCore';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 100;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error('--batch-size must be an integer between 1 and 1000');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });

backfillProjectWorkingDirectoryInstances(pool, {
  apply,
  batchSize,
  onBatch: (progress) => console.log(JSON.stringify({ apply, ...progress })),
})
  .then((progress) => console.log(JSON.stringify({ apply, complete: true, ...progress })))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

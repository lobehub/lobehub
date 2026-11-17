/**
 * One-off merge of existing projects' coordinators into the project-owned model
 * (T-14322 §e): classify every project's main agent, log the decision with a
 * configuration snapshot, and mark the agents a project provisioned for itself
 * alone with `agents.owner_project_id`. No configuration is rewritten or deleted.
 * See packages/database/src/repositories/projectCoordinatorOwnership.
 *
 * Dry-run by default; pass --apply to write, --revert to undo the marks.
 * Idempotent and resumable.
 *
 *   bunx tsx scripts/backfillProjectCoordinatorOwnership.ts
 *   bunx tsx scripts/backfillProjectCoordinatorOwnership.ts --apply --batch-size=500
 *   bunx tsx scripts/backfillProjectCoordinatorOwnership.ts --revert
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import {
  backfillProjectCoordinatorOwnership,
  revertProjectCoordinatorOwnership,
} from '../packages/database/src/repositories/projectCoordinatorOwnership';
import * as schema from '../packages/database/src/schemas';
import type { LobeChatDatabase } from '../packages/database/src/type';

const DEFAULT_BATCH_SIZE = 500;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const revert = args.has('--revert');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error('--batch-size must be an integer between 1 and 1000');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString });
const db = drizzle(pool, { schema }) as unknown as LobeChatDatabase;

const run = async () => {
  if (revert) {
    console.log(JSON.stringify({ revert: true, ...(await revertProjectCoordinatorOwnership(db)) }));
    return;
  }
  const progress = await backfillProjectCoordinatorOwnership(db, {
    apply,
    batchSize,
    onBatch: (batch) => console.log(JSON.stringify({ apply, ...batch })),
  });
  console.log(JSON.stringify({ apply, complete: true, ...progress }));
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

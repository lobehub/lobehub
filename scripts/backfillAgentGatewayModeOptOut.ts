/**
 * Copy the retired global Gateway Mode opt-out onto each personal Agent.
 * See backfillAgentGatewayModeOptOutCore.ts for the selection rules.
 *
 * Dry-run by default; pass --apply to write. Idempotent and resumable.
 * Pass the release's deploy time as --created-before so Agents created after
 * it keep the new default; it defaults to now. Each batch line lists the
 * written Agent ids (`agentIds`); keep the output to roll back if needed.
 *
 *   bunx tsx scripts/backfillAgentGatewayModeOptOut.ts
 *   bunx tsx scripts/backfillAgentGatewayModeOptOut.ts --apply --created-before=2026-12-01T00:00:00Z
 */
import pg from 'pg';

import { backfillAgentGatewayModeOptOut } from './backfillAgentGatewayModeOptOutCore';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 100;

const readArg = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const apply = process.argv.includes('--apply');
const batchSizeArg = readArg('batch-size');
const batchSize = batchSizeArg ? Number.parseInt(batchSizeArg, 10) : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error('--batch-size must be an integer between 1 and 1000');
}

const createdBeforeArg = readArg('created-before');
const createdBefore = createdBeforeArg ? new Date(createdBeforeArg) : new Date();
if (Number.isNaN(createdBefore.getTime())) {
  throw new Error('--created-before must be an ISO timestamp');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });

backfillAgentGatewayModeOptOut(pool, {
  apply,
  batchSize,
  createdBefore,
  onBatch: (progress) => console.log(JSON.stringify({ apply, ...progress })),
})
  .then((progress) =>
    console.log(
      JSON.stringify({
        apply,
        complete: true,
        createdBefore: createdBefore.toISOString(),
        ...progress,
      }),
    ),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

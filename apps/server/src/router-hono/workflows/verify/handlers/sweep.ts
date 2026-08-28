import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { sweepStuckVerifyRuns } from '@/server/services/verify';

const log = debug('lobe-server:workflows:verify:sweep');

/**
 * Cron-style sweep for verification runs stranded in `verifying` — see
 * {@link sweepStuckVerifyRuns} for what strands them and how each shape is
 * recovered.
 *
 * No per-user authentication: this is a global scan registered as a QStash
 * Schedule (cron). Signature verification is handled by the `qstashAuth`
 * middleware mounted on the route.
 */
export async function sweep(c: Context) {
  try {
    const db = await getServerDB();
    const outcome = await sweepStuckVerifyRuns(db);

    log(
      'Verify sweep: settled=%d abandoned=%d skipped=%d',
      outcome.settled.length,
      outcome.abandoned.length,
      outcome.skipped,
    );
    return c.json({ ...outcome, success: true });
  } catch (error) {
    console.error('[verify/sweep] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

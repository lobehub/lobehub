import debug from 'debug';
import type { Context } from 'hono';

import { AgentShareModel } from '@/database/models/agentShare';
import { getServerDB } from '@/database/server';

const log = debug('lobe-server:workflows:agent-share:sweep');

/**
 * Cron-style sweep for `agent_share_run_reservations` rows abandoned before
 * they ever reached `confirmReservation` or the catch-path
 * `releaseReservation` — e.g. the request process died between
 * `assertRunnableForVisitor` inserting the row and `createOperation`
 * returning. See {@link AgentShareModel.sweepAbandonedReservations} for why
 * this is safe (a belated confirm on a swept row just fails closed, same as
 * a live revocation) and why age, not status, is the only filter needed.
 *
 * No per-user authentication: this is a global scan registered as a QStash
 * Schedule (cron), same pattern as `workflows/verify/handlers/sweep.ts`.
 * Signature verification is handled by the `qstashAuth` middleware mounted on
 * the route.
 */
export async function sweep(c: Context) {
  try {
    const db = await getServerDB();
    const swept = await AgentShareModel.sweepAbandonedReservations(db);

    log('Agent share reservation sweep: deleted=%d', swept.length);
    return c.json({ deleted: swept.length, success: true });
  } catch (error) {
    console.error('[agent-share/sweep] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

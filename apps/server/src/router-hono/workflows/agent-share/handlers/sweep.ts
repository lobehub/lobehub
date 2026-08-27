import debug from 'debug';
import { inArray } from 'drizzle-orm';
import type { Context } from 'hono';

import { AgentShareModel } from '@/database/models/agentShare';
import { agents } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { AiAgentService } from '@/server/services/aiAgent';

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
 * Beyond deleting the row, this ALSO calls `AiAgentService.interruptTask` for
 * every swept operation — mirroring `interruptActiveShareRuns`'s handling of
 * `revokeReservations`'s rows. Without this, deleting the reservation only
 * stops a STILL-LIVE originating request from confirming; it does nothing
 * for the far more likely reason a row survives 30 minutes unswept: that
 * request's process died before ever reaching `confirmReservation`; the
 * queue message `createOperation` already scheduled for it keeps executing
 * under the creator's credentials/budget with no topic `runningOperation`
 * marker for the visitor's `interruptTask` to find. Interrupting here closes
 * that window — bounded by `maxAgeMs` (default 30 minutes), see
 * `sweepAbandonedReservations`'s JSDoc for why a proactive, unconditional
 * confirmation gate at step-0 pickup (`AgentRuntimeService.executeStep`'s
 * `verifyShareReservationStatus` delegate call) is the primary defense and
 * this sweep is the bounded backstop for any other failure shape that skips
 * that gate (e.g. a `maxAgeMs`-tuned deploy racing an in-flight
 * `createOperation`).
 *
 * Each row only carries `agentId`, not the creator's `userId` — resolved
 * here via one batched `agents` lookup so `AiAgentService` (and the
 * `TopicModel` it constructs) can be scoped correctly; `interruptTask`'s
 * topic/operation lookups are ownership-filtered by that `userId`. An agent
 * that has since been deleted (no matching row) is skipped — its topics and
 * reservations already cascade-deleted with it (see the FK `onDelete:
 * 'cascade'` on `agentShareRunReservations.agentId`), so there's nothing left
 * to interrupt.
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

    if (swept.length > 0) {
      const agentIds = [...new Set(swept.map((row) => row.agentId))];
      const ownerRows = await db
        .select({ id: agents.id, userId: agents.userId })
        .from(agents)
        .where(inArray(agents.id, agentIds));
      const ownerByAgentId = new Map(ownerRows.map((row) => [row.id, row.userId]));

      let interrupted = 0;
      await Promise.all(
        swept.map(async ({ agentId, operationId, topicId }) => {
          const ownerId = ownerByAgentId.get(agentId);
          if (!ownerId) return;

          try {
            await new AiAgentService(db, ownerId).interruptTask({ operationId, topicId });
            interrupted += 1;
          } catch (error) {
            log(
              'Agent share reservation sweep: failed to interrupt operationId=%s topicId=%s: %O',
              operationId,
              topicId,
              error,
            );
          }
        }),
      );
      log('Agent share reservation sweep: interrupted=%d', interrupted);
    }

    return c.json({ deleted: swept.length, success: true });
  } catch (error) {
    console.error('[agent-share/sweep] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

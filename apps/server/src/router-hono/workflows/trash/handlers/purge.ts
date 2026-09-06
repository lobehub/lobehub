import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { TrashService } from '@/server/services/trash';
import type { TrashPurgeWorkflowPayload } from '@/server/workflows/trash';
import { triggerTrashPurge } from '@/server/workflows/trash';

const log = debug('lobe-server:workflows:trash:purge');

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
const DEFAULT_BATCH_BUDGET = 8;
const BURST_ROLLOVER_DELAY_SECONDS = 60;

/**
 * Cron-style purge of recycle-bin roots past their retention window — see
 * {@link TrashService.sweepExpired}. Also prunes registry rows whose resource
 * is already gone.
 *
 * No per-user authentication: this is a global scan registered as a QStash
 * Schedule (e.g. `0 * * * *`) pointing at `/api/workflows/trash/purge`.
 * Signature verification is handled by the `qstashAuth` middleware mounted on
 * the route. Each message handles a bounded batch and can enqueue another
 * bounded message. Immediate bursts are capped by `remainingBatches`; a full
 * burst rolls over to a delayed message with the same cursor, so large queues
 * drain without either a hot loop or repeatedly scanning poisoned roots.
 */
export async function purge(c: Context) {
  try {
    const body = await c.req
      .json<TrashPurgeWorkflowPayload>()
      .catch(() => ({}) as TrashPurgeWorkflowPayload);
    const limit = Math.min(Math.max(body.limit ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    const remainingBatches = Math.min(
      Math.max(body.remainingBatches ?? DEFAULT_BATCH_BUDGET, 1),
      DEFAULT_BATCH_BUDGET,
    );
    const db = await getServerDB();
    const cursor =
      body.cursor &&
      typeof body.cursor.expiresAt === 'string' &&
      !Number.isNaN(new Date(body.cursor.expiresAt).getTime()) &&
      typeof body.cursor.id === 'string' &&
      body.cursor.id
        ? body.cursor
        : undefined;
    const outcome = await TrashService.sweepExpired(db, { cursor, limit });
    let continued = false;

    if (outcome.scanned === limit && outcome.nextCursor) {
      if (remainingBatches > 1) {
        continued = await triggerTrashPurge({
          cursor: outcome.nextCursor,
          limit,
          remainingBatches: remainingBatches - 1,
        });
      } else {
        continued = await triggerTrashPurge(
          { cursor: outcome.nextCursor, limit, remainingBatches: DEFAULT_BATCH_BUDGET },
          { delay: BURST_ROLLOVER_DELAY_SECONDS },
        );
      }
    }

    log(
      'Trash purge: scanned=%d purged=%d failed=%d pruned=%d continued=%s',
      outcome.scanned,
      outcome.purged,
      outcome.failed,
      outcome.pruned,
      continued,
    );
    return c.json({ ...outcome, continued, success: true });
  } catch (error) {
    console.error('[trash/purge] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

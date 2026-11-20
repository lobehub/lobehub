import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { TrashService } from '@/server/services/trash';

const log = debug('lobe-server:workflows:trash:purge');

/**
 * Cron-style purge of recycle-bin roots past their retention window — see
 * {@link TrashService.sweepExpired}. Also prunes registry rows whose resource
 * is already gone.
 *
 * No per-user authentication: this is a global scan registered as a QStash
 * Schedule (e.g. `0 * * * *`) pointing at `/api/workflows/trash/purge`.
 * Signature verification is handled by the `qstashAuth` middleware mounted on
 * the route. Accepts an optional JSON body `{ limit?: number }` to tune the
 * per-tick batch.
 */
export async function purge(c: Context) {
  try {
    const body = await c.req.json<{ limit?: number }>().catch(() => ({}) as { limit?: number });
    const db = await getServerDB();
    const outcome = await TrashService.sweepExpired(db, { limit: body?.limit });

    log(
      'Trash purge: purged=%d failed=%d pruned=%d',
      outcome.purged,
      outcome.failed,
      outcome.pruned,
    );
    return c.json({ ...outcome, success: true });
  } catch (error) {
    console.error('[trash/purge] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

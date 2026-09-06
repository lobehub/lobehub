import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { StaleOperationReaper } from '@/server/services/agentRuntime';

const log = debug('lobe-server:agent:reap-operations');

/**
 * Vercel cron entry point for recovering operations whose executing host died
 * mid-step — see {@link StaleOperationReaper}.
 *
 * Auth: `bearerSecretAuth(CRON_SECRET)` on the route, matching the existing
 * `/api/agent/gateway` cron.
 *
 * Query params (all optional, mainly for manual runs and incident response):
 * - `staleAfterMs` — override the lease window
 * - `limit` — cap the operations examined in this tick
 * - `maxRedriveAttempts` — override the per-operation redrive budget
 */
export async function reapOperations(c: Context): Promise<Response> {
  const startedAt = Date.now();

  const num = (name: string): number | undefined => {
    const raw = c.req.query(name);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };

  try {
    const serverDB = await getServerDB();
    const result = await new StaleOperationReaper(serverDB).sweep({
      limit: num('limit'),
      maxRedriveAttempts: num('maxRedriveAttempts'),
      staleAfterMs: num('staleAfterMs'),
    });

    log('sweep completed in %dms: %O', Date.now() - startedAt, result);

    return c.json({ ...result, executionTime: Date.now() - startedAt, success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[reap-operations] %O', error);

    return c.json({ error: message, executionTime: Date.now() - startedAt, success: false }, 500);
  }
}

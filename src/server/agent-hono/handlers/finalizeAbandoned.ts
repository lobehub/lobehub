import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AbandonOperationService } from '@/server/services/agentRuntime';

const log = debug('lobe-server:agent:finalize-abandoned');

/**
 * Reverse-trigger finalization for an operation whose Vercel function was
 * killed mid-flight. Called by the agent-gateway DO inactivity watchdog when
 * an op has gone silent past the threshold — see LOBE-8533.
 *
 * Body: `{ operationId: string, reason: string }`
 *
 * Auth: handled by the `serviceTokenAuth` middleware on the route.
 */
export async function finalizeAbandoned(c: Context): Promise<Response> {
  const startTime = Date.now();

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const { operationId, reason } = body as { operationId?: string; reason?: string };
  if (!operationId) return c.json({ error: 'operationId is required' }, 400);
  if (!reason) return c.json({ error: 'reason is required' }, 400);

  log('[%s] finalize-abandoned (reason=%s)', operationId, reason);

  try {
    const serverDB = await getServerDB();
    const service = new AbandonOperationService(serverDB);
    const result = await service.finalizeAbandoned(operationId, reason);

    const executionTime = Date.now() - startTime;
    log('[%s] finalize-abandoned done in %dms: %O', operationId, executionTime, result);

    return c.json({ ...result, executionTime, operationId, reason });
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[finalize-abandoned] %O', error);
    return c.json({ error: message, executionTime, operationId }, 500);
  }
}

import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AbandonOperationService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:finalize-abandoned');

/**
 * Reverse-trigger finalization for an operation whose Vercel function was
 * killed mid-flight. Called by the agent-gateway DO inactivity watchdog when
 * an op has gone silent past the threshold — see .
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

    // If the abandoned op was a sub-agent, resume its parent: the watchdog
    // killed the child without firing its onComplete bridge, so the parent
    // stays parked in `waiting_for_async_tool` until this runs. Mirrors the
    // queue-mode `/subagent-callback` handler — bridge through AiAgentService so
    // the runtime's models stay workspace-scoped. CAS-guarded and idempotent, so
    // it's safe even if the bounded async-tool verify watchdog also fires.
    let parentResumed: boolean | undefined;
    if (result.subAgentResume) {
      const { parentOperationId, threadId, toolMessageId, userId, workspaceId } =
        result.subAgentResume;
      try {
        const aiAgentService = new AiAgentService(serverDB, userId, { workspaceId });
        parentResumed = await aiAgentService.completeSubAgentBridge({
          operationId,
          parentOperationId,
          // Child reached a terminal failure (watchdog kill) → backfill the
          // parent's tool slot with an error note rather than a stub answer.
          reason: 'error',
          threadId,
          toolMessageId,
        });
        log(
          '[%s] resumed parent %s after sub-agent abandon (won=%s)',
          operationId,
          parentOperationId,
          parentResumed,
        );
      } catch (bridgeError) {
        // Non-fatal: the parent's bounded async-tool verify watchdog is the
        // fallback. Don't fail the abandon ack (QStash would redeliver the whole
        // finalize), just surface it.
        console.error('[finalize-abandoned] parent resume bridge failed: %O', bridgeError);
      }
    }

    const executionTime = Date.now() - startTime;
    log('[%s] finalize-abandoned done in %dms: %O', operationId, executionTime, result);

    return c.json({ ...result, executionTime, operationId, parentResumed, reason });
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[finalize-abandoned] %O', error);
    return c.json({ error: message, executionTime, operationId }, 500);
  }
}

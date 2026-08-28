import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AbandonOperationService } from '@/server/services/agentRuntime';
import { deliverWebhook } from '@/server/services/agentRuntime/hooks/HookDispatcher';
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
    // stays parked in `waiting_for_async_tool` until this runs.
    //
    // This endpoint is called by the DO inactivity watchdog EXACTLY ONCE and is
    // never retried, so the resume must carry its own durability. A transient
    // DB/Redis failure mid-bridge (the backfill in particular) cannot be
    // recovered by the parent's async-tool verify watchdog — that only re-reads
    // the barrier, it can't recreate the missing tool-message backfill. So in
    // queue mode we hand off to the same QStash-backed `/subagent-callback` the
    // normal completion path uses: QStash redelivers on non-2xx until the
    // backfill + CAS-resume land (the callback re-resolves userId from the
    // coordinator metadata, which `finalizeAbandoned` deliberately keeps alive
    // for sub-agent ops). In local/dev (no queue) we run the bridge inline.
    //
    // Failures intentionally propagate to the outer catch (→ non-2xx) instead of
    // being swallowed behind a 200: a 200 here would falsely report the parent
    // as handled while it stays parked forever.
    if (result.subAgentResume) {
      const { parentOperationId, threadId, toolMessageId, userId, workspaceId } =
        result.subAgentResume;
      // Child reached a terminal failure (watchdog kill) → the bridge backfills
      // the parent's tool slot with an error note rather than a stub answer.
      const bridgeBody = {
        operationId,
        parentOperationId,
        reason: 'error',
        threadId,
        toolMessageId,
      };
      if (process.env.QSTASH_TOKEN) {
        await deliverWebhook(
          { delivery: 'qstash', fallback: 'none', url: '/api/agent/webhooks/subagent-callback' },
          bridgeBody,
        );
        log('[%s] queued durable parent-resume for %s', operationId, parentOperationId);
      } else {
        // No durable queue configured: run the CAS-guarded, idempotent bridge
        // inline through AiAgentService so the runtime's models stay
        // workspace-scoped.
        const aiAgentService = new AiAgentService(serverDB, userId, { workspaceId });
        const won = await aiAgentService.completeSubAgentBridge(bridgeBody);
        log(
          '[%s] resumed parent %s inline (local mode, won=%s)',
          operationId,
          parentOperationId,
          won,
        );
      }
    }

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

import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { isAsyncShellEnabled } from '@/server/modules/AgentRuntime/asyncShellPark';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';

import { resolveOperationOwner } from './resolveOperationOwner';

const log = debug('lobe-server:agent:tool-result');

const TOOL_RESULT_TTL_SECONDS = 120;

const ToolResultBodySchema = z.object({
  content: z.string().nullable(),
  /**
   * The device finished a tool long after its dispatch returned (a background
   * shell command). There is no BLPOP waiter for it: the operation is parked,
   * so it is delivered to the resume path instead of the blocking queue.
   */
  deferred: z.boolean().optional(),
  error: z
    .object({
      message: z.string(),
      type: z.string().optional(),
    })
    .optional(),
  /**
   * Wall time the tool took on the DEVICE, by its own clock. `z.object` strips
   * unknown keys, so this has to be declared to survive at all — and it is
   * optional because it only arrives when both the device and the gateway are
   * new enough to send it.
   */
  executionTimeMs: z.number().nonnegative().optional(),
  /**
   * Operation the result belongs to. Only forwarded for a deferred result,
   * whose dispatching step is long gone — without it there is no way back to
   * the parked operation.
   */
  operationId: z.string().optional(),
  state: z.record(z.string(), z.any()).optional(),
  success: z.boolean(),
  toolCallId: z.string().min(1),
});

/**
 * Receive a tool execution result from agent-gateway, originating from a
 * client that executed a server-dispatched `tool_execute`.
 *
 * Two delivery modes:
 * - **Synchronous** (the default): LPUSH into a per-toolCallId list so the
 *   server-side agent loop's BLPOP can wake up and continue.
 * - **Deferred** (`deferred: true`): the dispatching step is over and the
 *   operation is parked, so there is nothing to wake. The result is written
 *   into the placeholder tool message and the parked operation is resumed.
 *
 * Auth: `serviceTokenAuth` on the route (gateway is the only trusted caller).
 * Idempotency is not required for the synchronous path — BLPOP pops the first
 * available value; duplicates sit under TTL until they expire. The deferred
 * path is idempotent by construction: the backfill is `onlyIfEmpty` and the
 * resume is CAS-guarded.
 */
export async function toolResult(c: Context): Promise<Response> {
  let parsed;
  try {
    const body = await c.req.json();
    parsed = ToolResultBodySchema.safeParse(body);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  if (parsed.data.deferred) {
    return handleDeferredResult(c, parsed.data);
  }

  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    log('Redis is not available');
    return c.json({ error: 'Redis unavailable' }, 503);
  }

  const { toolCallId } = parsed.data;
  const key = `tool_result:${toolCallId}`;

  try {
    await redis
      .pipeline()
      .lpush(key, JSON.stringify(parsed.data))
      .expire(key, TOOL_RESULT_TTL_SECONDS)
      .exec();
    log('Persisted tool result for %s (success=%s)', toolCallId, parsed.data.success);
  } catch (error) {
    log('Failed to LPUSH tool result for %s: %O', toolCallId, error);
    return c.json({ error: 'Redis write failed' }, 503);
  }

  return c.body(null, 204);
}

/**
 * Deliver a result whose operation is parked.
 *
 * Owner resolution mirrors `/subagent-callback`: the body is
 * service-token-verified, and the operation row is the authority for whose
 * rows the backfill and the resume barrier must see.
 */
async function handleDeferredResult(
  c: Context,
  data: z.infer<typeof ToolResultBodySchema>,
): Promise<Response> {
  const { operationId, toolCallId } = data;
  if (!operationId) {
    log('Deferred result %s has no operationId', toolCallId);
    return c.json({ error: 'operationId is required for a deferred result' }, 400);
  }

  try {
    const serverDB = await getServerDB();
    const owner = await resolveOperationOwner(serverDB, operationId);

    if (!owner) {
      log('Deferred result: no owner for operation %s', operationId);
      return c.json({ error: 'Invalid operation or unauthorized' }, 401);
    }

    const aiAgentService = new AiAgentService(serverDB, owner.userId, {
      includeShareVisitor: Boolean(owner.streamOwnerUserId),
      workspaceId: owner.workspaceId,
    });

    const outcome = await aiAgentService.completeDeferredShell({
      operationId,
      result: {
        content: data.content,
        error: data.error,
        executionTimeMs: data.executionTimeMs,
        state: data.state,
        success: data.success,
        toolCallId,
      },
    });

    log(
      'Deferred result op=%s tool=%s handled=%s',
      operationId,
      toolCallId,
      String(outcome.handled),
    );

    if (!outcome.handled && outcome.reason === 'placeholder_missing' && isAsyncShellEnabled()) {
      // The park writes the placeholder right after the running receipt returns
      // through `dispatchClientTool`, so a command that ends immediately can
      // report before the row exists. The device sends this result exactly once:
      // acknowledging it would discard the only copy of the answer and leave the
      // run parked on a command that already finished. Reject instead, so the
      // gateway's outbound retry redelivers once the row is there — a duplicate
      // is harmless, the backfill is `onlyIfEmpty` and the resume is CAS-guarded.
      log('Deferred result op=%s tool=%s has no placeholder yet', operationId, toolCallId);
      return c.json({ error: 'Deferred shell placeholder is not ready', retryable: true }, 503);
    }

    // Otherwise `handled: false` means this was not a parked shell at all. A 200
    // still acknowledges it: the device will not resend, and the synchronous
    // queue never had a waiter for a tool that was never dispatched there.
    return c.json(outcome);
  } catch (error) {
    console.error('[agent/tool-result] deferred delivery failed:', error);
    // Non-2xx so the gateway's outbound retry can redeliver; the backfill is
    // idempotent and the resume is CAS-guarded, so a duplicate is harmless.
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

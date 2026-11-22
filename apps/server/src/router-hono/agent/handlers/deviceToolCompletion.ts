import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AiAgentService } from '@/server/services/aiAgent';

import { resolveOperationOwner } from './resolveOperationOwner';

const log = debug('lobe-server:agent:device-tool-completion');

const DeviceToolCompletionBodySchema = z.object({
  deviceId: z.string().min(1),
  operationId: z.string().min(1),
  result: z.object({
    content: z.string().nullable().optional(),
    error: z.unknown().optional(),
    executionTimeMs: z.number().nonnegative().optional(),
    state: z.record(z.string(), z.any()).optional(),
    success: z.boolean(),
  }),
  toolCallId: z.string().min(1),
  /** The principal the gateway dispatched the call under: one of the two. */
  userId: z.string().optional(),
  workspaceId: z.string().optional(),
});

const toErrorPayload = (error: unknown) => {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'string') return { message: error, type: 'device_error' };
  if (typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string')
    return error as { message: string; type?: string };
  return { message: String(error), type: 'device_error' };
};

/**
 * Receive the late, final result of a device tool call — a shell command the
 * device kept watching after its `runCommand` reply — relayed by the device
 * gateway, and resume the operation parked on it.
 *
 * Auth: `deviceGatewayServiceAuth` on the route. The gateway only forwards a
 * completion for a call the server registered, and reports the principal it
 * dispatched under; that principal must own the operation, so one account's
 * device cannot complete another account's run.
 *
 * Responses map to the gateway's ack: 2xx → `delivered`, 4xx → `rejected`,
 * 5xx → `retry` (the device resends). Delivery is idempotent: the backfill is
 * `onlyIfEmpty` and the resume is CAS-guarded.
 */
export async function deviceToolCompletion(c: Context): Promise<Response> {
  let parsed;
  try {
    parsed = DeviceToolCompletionBodySchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const { operationId, result, toolCallId, userId, workspaceId } = parsed.data;

  try {
    const serverDB = await getServerDB();
    const owner = await resolveOperationOwner(serverDB, operationId);
    if (!owner) {
      log('No owner for operation %s', operationId);
      return c.json({ error: 'Unknown operation' }, 404);
    }

    const principalMatches = workspaceId
      ? owner.workspaceId === workspaceId
      : !!userId && owner.userId === userId;
    if (!principalMatches) {
      log('Principal mismatch for operation %s (tool=%s)', operationId, toolCallId);
      return c.json({ error: 'Operation does not belong to this device principal' }, 403);
    }

    const aiAgentService = new AiAgentService(serverDB, owner.userId, {
      includeShareVisitor: Boolean(owner.streamOwnerUserId),
      workspaceId: owner.workspaceId,
    });

    const outcome = await aiAgentService.completeDeferredShell({
      operationId,
      result: {
        content: result.content ?? null,
        error: toErrorPayload(result.error),
        executionTimeMs: result.executionTimeMs,
        state: result.state,
        success: result.success,
        toolCallId,
      },
    });

    log('op=%s tool=%s handled=%s', operationId, toolCallId, String(outcome.handled));

    if (!outcome.handled && outcome.reason === 'placeholder_missing') {
      // The park writes the placeholder right after the device's `runCommand`
      // reply returns, so a command that ends at once can report first. Ask for
      // a resend instead of acknowledging away the only copy of the answer.
      return c.json({ error: 'Placeholder is not ready', retryable: true }, 503);
    }

    // `not_deferred_shell`: the call was never parked (the server answered it
    // with the `shell_id` instead). Acknowledge so the device stops resending.
    return c.json(outcome);
  } catch (error) {
    console.error('[agent/device-tool-completion] delivery failed:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

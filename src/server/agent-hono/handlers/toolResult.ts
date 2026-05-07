import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:agent:tool-result');

const TOOL_RESULT_TTL_SECONDS = 120;

const ToolResultBodySchema = z.object({
  content: z.string().nullable(),
  error: z
    .object({
      message: z.string(),
      type: z.string().optional(),
    })
    .optional(),
  success: z.boolean(),
  toolCallId: z.string().min(1),
});

/**
 * Receive a tool execution result from agent-gateway, originating from a
 * client that executed a server-dispatched `tool_execute`. The result is
 * LPUSH'd into a per-toolCallId list so the server-side agent loop's BLPOP
 * can wake up and continue.
 *
 * Auth: `serviceTokenAuth` on the route (gateway is the only trusted caller).
 * Idempotency is not required — BLPOP pops the first available value;
 * duplicates sit under TTL until they expire.
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

import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('api-route:agent:tool-result');

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
 * Receive a tool execution result from Agent Gateway, originating from a
 * client that executed a server-dispatched tool_execute. The result is
 * LPUSH'd into a per-toolCallId list so the server-side agent loop's BLPOP
 * can wake up and continue.
 *
 * Authenticated with AGENT_GATEWAY_SERVICE_TOKEN (the Gateway is the only
 * trusted caller). Idempotency is not required: BLPOP will pop the first
 * available value; duplicates sit under TTL until they expire.
 */
export async function POST(request: NextRequest) {
  const serviceToken = appEnv.AGENT_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    log('AGENT_GATEWAY_SERVICE_TOKEN is not configured');
    return NextResponse.json({ error: 'Service not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${serviceToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsed;
  try {
    const body = await request.json();
    parsed = ToolResultBodySchema.safeParse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    log('Redis is not available');
    return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
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
    return NextResponse.json({ error: 'Redis write failed' }, { status: 503 });
  }

  return new NextResponse(null, { status: 204 });
}

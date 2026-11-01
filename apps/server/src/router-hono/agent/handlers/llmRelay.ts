import type { LlmRelayBatchAck } from '@lobechat/agent-gateway-client';
import debug from 'debug';
import type { Context } from 'hono';
import type Redis from 'ioredis';
import { z } from 'zod';

import {
  LLM_RELAY_KEY_GRACE_MS,
  LLM_RELAY_LEASE_HEADER,
  LLM_RELAY_MAX_BATCH_BYTES,
  LLM_RELAY_MAX_CALL_BYTES,
  LLM_RELAY_STREAM_MAXLEN,
  llmRelayKeys,
  verifyLlmRelayLease,
} from '@/server/modules/AgentRuntime/llmRelay/protocol';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:agent:llm-relay');

const BatchSchema = z.object({
  chunks: z.array(z.object({ data: z.unknown(), id: z.string().optional(), type: z.string() })),
  clientId: z.string().min(1),
  final: z
    .object({
      error: z.unknown().optional(),
      reason: z.enum(['aborted', 'done', 'error']),
    })
    .optional(),
  seq: z.number().int().positive(),
});

/**
 * Authorize a relay request: the lease token from `llm_execute` must name this
 * call, and the call must still be open for the token's user. A closed call
 * answers `410` so a late executor stops instead of retrying.
 */
type Authorized = { callId: string; redis: Redis } | { response: Response };

const authorize = async (c: Context): Promise<Authorized> => {
  const callId = c.req.param('callId');
  if (!callId) return { response: c.json({ error: 'Missing callId' }, 400) };

  const claims = verifyLlmRelayLease(c.req.header(LLM_RELAY_LEASE_HEADER), callId);
  if (!claims) return { response: c.json({ error: 'Invalid or expired lease' }, 401) };

  const redis = getAgentRuntimeRedisClient();
  if (!redis) return { response: c.json({ error: 'Redis unavailable' }, 503) };

  const owner = await redis.get(llmRelayKeys.open(callId));
  if (!owner) return { response: c.json({ cancel: true, error: 'Call is closed' }, 410) };
  if (owner !== claims.userId) return { response: c.json({ error: 'Forbidden' }, 403) };

  return { callId, redis };
};

/**
 * Read a request body as text, giving up once it passes `limit` bytes — by the
 * declared `content-length` up front, else while streaming — so an oversized
 * upload is never buffered in full. `undefined` means the body was too large.
 */
const readBodyWithin = async (req: Request, limit: number): Promise<string | undefined> => {
  if (Number(req.headers.get('content-length')) > limit) return undefined;
  if (!req.body) return '';

  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
};

/**
 * `GET /api/agent/llm-relay/:callId/payload` — the request body of a relayed
 * LLM attempt (messages, tools, model parameters), exactly as the server would
 * have sent it to the provider. Kept out of the `llm_execute` event so large
 * contexts never ride the gateway socket.
 */
export async function llmRelayPayload(c: Context): Promise<Response> {
  const auth = await authorize(c);
  if ('response' in auth) return auth.response;

  const payload = await auth.redis.get(llmRelayKeys.payload(auth.callId));
  if (!payload) return c.json({ cancel: true, error: 'Call is closed' }, 410);

  return c.body(payload, 200, { 'content-type': 'application/json' });
}

/**
 * `POST /api/agent/llm-relay/:callId/chunks` — one batch of a relayed attempt's
 * protocol chunks. Only validates and appends to the call's Redis Stream; the
 * attempt running in the agent step reads, reorders and dedupes by `seq`.
 *
 * - the first batch claims the call for its client (`SET NX`); any other
 *   client gets `409` and must drop its local output
 * - `413` past 256 KB per batch or 16 MB per call; the attempt then fails on
 *   its idle deadline. The lease is checked first and the batch limit is
 *   enforced while reading, so an unauthorized or oversized body is never
 *   buffered whole
 * - the reply carries `cancel: true` once the server no longer wants the attempt
 */
export async function llmRelayChunks(c: Context): Promise<Response> {
  // Authorize from the headers before touching the body, so a caller without
  // a valid lease can never make the server buffer anything.
  const auth = await authorize(c);
  if ('response' in auth) return auth.response;
  const { callId, redis } = auth;

  const raw = await readBodyWithin(c.req.raw, LLM_RELAY_MAX_BATCH_BYTES);
  if (raw === undefined) return c.json({ error: 'Batch too large' }, 413);

  let parsed;
  try {
    parsed = BatchSchema.safeParse(JSON.parse(raw));
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);

  const { clientId, ...batch } = parsed.data;
  const ttlMs = Math.max(await redis.pttl(llmRelayKeys.open(callId)), 0) + LLM_RELAY_KEY_GRACE_MS;

  await redis.set(llmRelayKeys.lease(callId), clientId, 'PX', ttlMs, 'NX');
  const holder = await redis.get(llmRelayKeys.lease(callId));
  if (holder !== clientId) {
    log('[%s] batch %d from %s rejected: claimed by %s', callId, batch.seq, clientId, holder);
    return c.json({ cancel: true, error: 'Call claimed by another client' }, 409);
  }

  const body = JSON.stringify(batch);
  const total = await redis.incrby(llmRelayKeys.bytes(callId), Buffer.byteLength(body));
  await redis.pexpire(llmRelayKeys.bytes(callId), ttlMs);
  if (total > LLM_RELAY_MAX_CALL_BYTES) return c.json({ error: 'Call output too large' }, 413);

  const [[, cancelled]] = (await redis
    .multi()
    .get(llmRelayKeys.cancel(callId))
    .xadd(
      llmRelayKeys.stream(callId),
      'MAXLEN',
      '~',
      LLM_RELAY_STREAM_MAXLEN,
      '*',
      'seq',
      String(batch.seq),
      'body',
      body,
    )
    .pexpire(llmRelayKeys.stream(callId), ttlMs)
    .exec()) as [[Error | null, string | null], ...unknown[]];

  const ack: LlmRelayBatchAck = { ackSeq: batch.seq, ...(cancelled && { cancel: true }) };
  return c.json(ack);
}

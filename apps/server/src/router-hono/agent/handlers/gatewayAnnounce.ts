import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { gatewayEnv } from '@/envs/gateway';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { GatewayService } from '@/server/services/gateway';
import type { MessageGatewayHost } from '@/server/services/gateway/MessageGatewayClient';

const log = debug('lobe-server:agent:gateway-announce');

const AnnounceSchema = z.object({
  /** Which gateway is speaking. Only its own connections are rebuilt. */
  host: z.enum(['default', 'node']),
  /** Advisory, for logs — the gateway's own view of why it restarted. */
  reason: z.string().max(200).optional(),
});

/**
 * How long after a SUCCESSFUL rebuild the same host is asked to wait before
 * requesting another. A crash-looping gateway would otherwise ask for one
 * every few seconds; the loop is the problem to fix, and rebuilding on every
 * iteration does not fix it. Only success starts the cooldown — a failed
 * rebuild must be retryable immediately, or a transient database blip would
 * strand the gateway until the periodic reconcile.
 */
const ANNOUNCE_COOLDOWN_SECONDS = 60;

/**
 * Upper bound on how long one rebuild may hold the slot. Only a crashed
 * invocation reaches it — the lock is released in `finally` — so it exists to
 * stop a dead process from blocking recovery, not to bound normal work.
 */
const ANNOUNCE_LOCK_SECONDS = 180;

const cooldownKey = (host: MessageGatewayHost) => `lobehub:gateway:announce:cooldown:${host}`;
const lockKey = (host: MessageGatewayHost) => `lobehub:gateway:announce:lock:${host}`;

/**
 * Ask the caller to come back later rather than dropping its request. The
 * caller is a gateway sitting on an empty registry: silently discarding its
 * announcement is how a restart that lands inside the window ends up waiting
 * for the periodic reconcile, which is the outage this endpoint exists to
 * prevent.
 */
const retryLater = (c: Context, seconds: number, why: string) => {
  c.header('Retry-After', String(seconds));
  return c.json({ reason: why, retryAfterSeconds: seconds, reconciled: false }, 429);
};

/**
 * A message gateway announcing that it came up with an empty registry.
 *
 * Authenticated with `MESSAGE_GATEWAY_SERVICE_TOKEN` — the same shared token
 * the gateways already use for state callbacks, so no new secret is
 * distributed.
 *
 * The rebuild runs before the response so its outcome reaches the caller: a
 * gateway told "done" when nothing was rebuilt would sit empty until the
 * periodic reconcile. Every answer this returns is one the caller can act on
 * — 200 rebuilt, 429 come back in N seconds, 503 try again, 204/4xx stop.
 */
export async function gatewayAnnounce(c: Context): Promise<Response> {
  // Mirror the state-callback handler: when the gateway feature is off,
  // connections are managed locally and a stale announcement must not kick
  // off a reconcile. 204 rather than 401 so an old deployment still shutting
  // down does not look like an auth failure.
  if (gatewayEnv.MESSAGE_GATEWAY_ENABLED !== '1') {
    return c.body(null, 204);
  }

  const serviceToken = gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    return c.json({ error: 'Service not configured' }, 503);
  }
  if (c.req.header('authorization') !== `Bearer ${serviceToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let parsed;
  try {
    parsed = AnnounceSchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const { host, reason } = parsed.data;
  const redis = getAgentRuntimeRedisClient();

  // Cooldown and lock are best-effort: without Redis the rebuild still runs,
  // which is the behaviour worth protecting. Only the crash-loop cap and the
  // overlap guard are lost.
  if (redis) {
    try {
      const cooling = await redis.ttl(cooldownKey(host));
      if (cooling > 0) return retryLater(c, cooling, 'cooldown');

      const locked = await redis.set(lockKey(host), '1', 'EX', ANNOUNCE_LOCK_SECONDS, 'NX');
      if (locked !== 'OK') return retryLater(c, 5, 'rebuild in progress');
    } catch (err) {
      log('announce: redis guard unavailable, rebuilding anyway: %O', err);
    }
  }

  log('announce from %s host, rebuilding (reason=%s)', host, reason ?? '-');

  // Rebuilt inline, not after the response, so the outcome reaches the caller.
  // The gateway is holding an empty registry and already retries with
  // backoff; letting it see a failure is what turns a transient database or
  // admin-surface blip into a retry instead of an outage lasting until the
  // periodic reconcile. Scoping keeps this cheap enough to await.
  try {
    await new GatewayService().reconcileHost(host);
    if (redis) {
      // Only a success starts the cooldown.
      await redis
        .set(cooldownKey(host), Date.now().toString(), 'EX', ANNOUNCE_COOLDOWN_SECONDS)
        .catch(() => undefined);
    }
    log('announce: %s host rebuilt', host);
    return c.json({ host, reconciled: true });
  } catch (err) {
    log('announce: %s host rebuild failed: %O', host, err);
    // 503 so the gateway's existing backoff retries; no cooldown was set, so
    // the retry is not turned away.
    return c.json({ error: 'Reconcile failed', reconciled: false }, 503);
  } finally {
    if (redis) await redis.del(lockKey(host)).catch(() => undefined);
  }
}

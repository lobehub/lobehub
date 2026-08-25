import { randomUUID } from 'node:crypto';

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
 * Lease on the lock, renewed while the rebuild is still running. Short so a
 * crashed invocation stops blocking recovery quickly; renewed so a slow one —
 * a large fleet, an unhurried database — never has its lease expire out from
 * under it, which would let a waiting caller start a second rebuild alongside
 * the first.
 */
const ANNOUNCE_LOCK_SECONDS = 30;

/** Renewal interval, comfortably inside the lease. */
const ANNOUNCE_LOCK_RENEW_MS = 10_000;

const cooldownKey = (host: MessageGatewayHost) => `lobehub:gateway:announce:cooldown:${host}`;
const lockKey = (host: MessageGatewayHost) => `lobehub:gateway:announce:lock:${host}`;

/**
 * Compare-and-delete: only ever drop the lock while it is still ours. A lease
 * that has already passed to someone else must not be released by its former
 * holder.
 */
const releaseLock = (
  redis: { eval: (...args: unknown[]) => Promise<unknown> },
  host: MessageGatewayHost,
  token: string,
) =>
  redis
    .eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      lockKey(host),
      token,
    )
    .catch(() => undefined);

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
  // Identifies THIS request's hold on the lock. Without it the release below
  // could delete a lock this request never acquired — after a transient Redis
  // error let it through, or after a rebuild outlived the lease and someone
  // else took over — which would let a crash loop run overlapping rebuilds.
  const lockToken = randomUUID();
  let holdsLock = false;

  if (redis) {
    try {
      const cooling = await redis.ttl(cooldownKey(host));
      if (cooling > 0) return retryLater(c, cooling, 'cooldown');

      const locked = await redis.set(lockKey(host), lockToken, 'EX', ANNOUNCE_LOCK_SECONDS, 'NX');
      if (locked !== 'OK') return retryLater(c, 5, 'rebuild in progress');
      holdsLock = true;

      // The two checks are not one atomic step, so a request that read no
      // cooldown while another was still rebuilding can arrive here just
      // after that one finished and wrote it. Without this re-read it would
      // start a second full rebuild immediately and walk straight past the
      // crash-loop cap.
      const settled = await redis.ttl(cooldownKey(host));
      if (settled > 0) {
        await releaseLock(redis, host, lockToken);
        holdsLock = false;
        return retryLater(c, settled, 'cooldown');
      }
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
  // Hold the lease open for as long as the work runs. Only ours is renewed —
  // the same compare-and-set the release uses — so a lease that already
  // passed to someone else is never extended.
  const renewer =
    redis && holdsLock
      ? setInterval(() => {
          void redis
            .eval(
              `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`,
              1,
              lockKey(host),
              lockToken,
              String(ANNOUNCE_LOCK_SECONDS),
            )
            .catch(() => undefined);
        }, ANNOUNCE_LOCK_RENEW_MS)
      : undefined;

  try {
    const outcome = await new GatewayService().reconcileHost(host);

    // The sync survives partial failure by design — an unreachable admin
    // surface, a platform that will not load, a connection that will not
    // build are all absorbed rather than thrown. Awaiting it therefore only
    // catches setup errors, so the outcome is what actually distinguishes
    // "your fleet is back" from "this round achieved nothing".
    if (!outcome.ok) {
      log('announce: %s host rebuild incomplete (%s)', host, outcome.reason);
      return c.json({ error: outcome.reason, reconciled: false }, 503);
    }

    if (redis) {
      // Only a clean rebuild starts the cooldown.
      await redis
        .set(cooldownKey(host), Date.now().toString(), 'EX', ANNOUNCE_COOLDOWN_SECONDS)
        .catch(() => undefined);
    }
    log('announce: %s host rebuilt (connected=%d)', host, outcome.connected);
    return c.json({ connected: outcome.connected, host, reconciled: true });
  } catch (err) {
    log('announce: %s host rebuild failed: %O', host, err);
    // 503 so the gateway's existing backoff retries; no cooldown was set, so
    // the retry is not turned away.
    return c.json({ error: 'Reconcile failed', reconciled: false }, 503);
  } finally {
    if (renewer) clearInterval(renewer);
    if (redis && holdsLock) await releaseLock(redis, host, lockToken);
  }
}

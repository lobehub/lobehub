import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { gatewayEnv } from '@/envs/gateway';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { GatewayService } from '@/server/services/gateway';
import type { MessageGatewayHost } from '@/server/services/gateway/MessageGatewayClient';
import { after } from '@/server/utils/scheduleAfterResponse';

const log = debug('lobe-server:agent:gateway-announce');

const AnnounceSchema = z.object({
  /** Which gateway is speaking. Only its own connections are rebuilt. */
  host: z.enum(['default', 'node']),
  /** Advisory, for logs — the gateway's own view of why it restarted. */
  reason: z.string().max(200).optional(),
});

/**
 * How long one host's announcements collapse into a single reconcile. A
 * crash-looping gateway would otherwise ask for a rebuild every few seconds;
 * the loop is the problem to fix, and hammering reconcile does not fix it.
 * Well under the periodic reconcile interval, so a genuine restart is never
 * left waiting for a whole cron round.
 */
const ANNOUNCE_DEBOUNCE_SECONDS = 60;

const debounceKey = (host: MessageGatewayHost) => `lobehub:gateway:announce:${host}`;

/**
 * A message gateway announcing that it came up with an empty registry.
 *
 * Authenticated with `MESSAGE_GATEWAY_SERVICE_TOKEN` — the same shared token
 * the gateways already use for state callbacks, so no new secret is
 * distributed. Responds immediately and reconciles after the response: the
 * caller is a gateway finishing its own boot, and it should not be held open
 * for the length of a fleet rebuild.
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

  // Debounce is best-effort: without Redis a restart still gets its rebuild,
  // which is the behaviour worth protecting. Only the crash-loop cap is lost.
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const acquired = await redis.set(
        debounceKey(host),
        Date.now().toString(),
        'EX',
        ANNOUNCE_DEBOUNCE_SECONDS,
        'NX',
      );
      if (acquired !== 'OK') {
        log('announce from %s host debounced (reason=%s)', host, reason ?? '-');
        return c.json({ reconciling: false, reason: 'debounced' });
      }
    } catch (err) {
      log('announce debounce check failed, reconciling anyway: %O', err);
    }
  }

  log('announce from %s host, scheduling reconcile (reason=%s)', host, reason ?? '-');

  after(async () => {
    try {
      await new GatewayService().reconcileHost(host);
      log('announce reconcile for %s host complete', host);
    } catch (err) {
      log('announce reconcile for %s host failed: %O', host, err);
    }
  });

  return c.json({ host, reconciling: true });
}

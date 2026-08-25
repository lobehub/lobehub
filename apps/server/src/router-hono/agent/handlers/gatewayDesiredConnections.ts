import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { gatewayEnv } from '@/envs/gateway';
import { GatewayService } from '@/server/services/gateway';
import { isMessageGatewayHostConfigured } from '@/server/services/gateway/MessageGatewayClient';

const log = debug('lobe-server:agent:gateway-desired-connections');

const BodySchema = z.object({
  host: z.enum(['default', 'node']),
});

/**
 * Hand a gateway the connect payloads it should currently be holding.
 *
 * This is how a gateway recovers from a restart. A container that just came
 * back up holds nothing, asks for this list, and rebuilds itself — the side
 * that establishes the connections is the same side that can see whether they
 * came up, so there is no reconciliation protocol to get wrong.
 *
 * The response body is exactly what the reconcile would have pushed:
 * `{ config, ensure }` per connection, the same shape as `POST /api/connections`
 * on the gateway. One builder feeds both paths on purpose — a second one would
 * drift, and the connection a gateway holds would then depend on who made it.
 *
 * Auth is inline, not a route middleware, so the disabled-feature 204
 * short-circuits before the token check (same reasoning as `gatewayCallback`).
 *
 * This endpoint returns every credential the named host needs, so it is also
 * the one place a single token can read the whole set. The audit log below is
 * the control that makes such a read visible; it doubles as the signal that
 * the host restarted.
 */
export async function gatewayDesiredConnections(c: Context): Promise<Response> {
  if (gatewayEnv.MESSAGE_GATEWAY_ENABLED !== '1') {
    return c.body(null, 204);
  }

  const serviceToken = gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    return c.json({ error: 'Service not configured' }, 503);
  }

  const authHeader = c.req.header('authorization');
  if (authHeader !== `Bearer ${serviceToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let parsed;
  try {
    parsed = BodySchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const { host } = parsed.data;

  // A host this deployment does not route to has no desired set to hand out.
  // Answering with an empty list would say "hold nothing", which is a
  // different claim from "I do not know you yet" — and the caller would stop
  // retrying on it. 503 keeps it retrying until the host is configured.
  if (!isMessageGatewayHostConfigured(host)) {
    log('host=%s is not configured on this deployment', host);
    return c.json({ error: `Message gateway host not configured: ${host}` }, 503);
  }

  const result = await new GatewayService().listDesiredConnectionsForHost(host);

  log(
    'gateway pull host=%s connections=%d excluded=%d complete=%s',
    host,
    result.connections.length,
    result.excluded,
    result.complete,
  );

  return c.json(result);
}

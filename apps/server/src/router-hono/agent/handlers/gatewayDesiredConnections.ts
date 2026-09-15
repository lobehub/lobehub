import debug from 'debug';
import type { Context } from 'hono';

import { gatewayEnv } from '@/envs/gateway';
import { GatewayService } from '@/server/services/gateway';
import {
  isMessageGatewayHostConfigured,
  type MessageGatewayHost,
} from '@/server/services/gateway/MessageGatewayClient';

const log = debug('lobe-server:agent:gateway-desired-connections');

/**
 * The host a presented credential speaks for.
 *
 * One credential, one host, and nothing the caller writes in the request takes
 * part. That is the whole mechanism: the server has to answer "which gateway
 * is asking" before it hands over that gateway's credentials, and a value the
 * caller supplies cannot answer it. A second pull-capable host gets its own
 * credential here — never a share of this one.
 */
function resolvePullHost(authorization: string | undefined): MessageGatewayHost | null {
  const nodeToken = gatewayEnv.MESSAGE_GATEWAY_NODE_PULL_TOKEN;
  if (nodeToken && authorization === `Bearer ${nodeToken}`) return 'node';
  return null;
}

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
 * Authenticated with a dedicated per-host credential rather than the shared
 * service token, because this is the one endpoint that returns credentials
 * rather than ids and states. The service token is written into every WeChat
 * connect payload as `webhookToken` and stored with the connection config, so
 * it lives across the gateway fleet's storage; making that same value a key
 * for reading every credential at once is a trade worth refusing for the cost
 * of one env var.
 *
 * Auth is inline, not a route middleware, so the disabled-feature 204
 * short-circuits before the credential check (same reasoning as
 * `gatewayCallback`).
 */
export async function gatewayDesiredConnections(c: Context): Promise<Response> {
  if (gatewayEnv.MESSAGE_GATEWAY_ENABLED !== '1') {
    return c.body(null, 204);
  }

  if (!gatewayEnv.MESSAGE_GATEWAY_NODE_PULL_TOKEN) {
    // Nothing can authenticate here yet. 503 keeps a gateway retrying until
    // the credential is configured, rather than reading a refusal as final.
    return c.json({ error: 'Service not configured' }, 503);
  }

  const host = resolvePullHost(c.req.header('authorization'));
  if (!host) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Configured to authenticate, but not to route anything here. An empty list
  // would say "hold nothing", which is a different claim from "I do not route
  // to you yet" — and the caller would stop retrying on it.
  if (!isMessageGatewayHostConfigured(host)) {
    log('host=%s is not configured on this deployment', host);
    return c.json({ error: `Message gateway host not configured: ${host}` }, 503);
  }

  const result = await new GatewayService().listDesiredConnectionsForHost(host);

  // Audit surface: the one place a host's whole credential set is handed out,
  // and the signal that the host restarted.
  log(
    'gateway pull host=%s connections=%d excluded=%d deferred=%d complete=%s',
    host,
    result.connections.length,
    result.excluded,
    result.deferred,
    result.complete,
  );

  return c.json(result);
}

import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { gatewayEnv } from '@/envs/gateway';

const log = debug('lobe-server:agent:device-gateway-service-auth');

/**
 * Authenticates the device gateway calling back into the server, against
 * `DEVICE_GATEWAY_SERVICE_TOKEN` via `Authorization: Bearer <token>` — the same
 * token the server presents when it dispatches to the gateway.
 *
 * Distinct from {@link serviceTokenAuth} (agent gateway): the two gateways hold
 * different secrets, and neither should be able to impersonate the other.
 */
export const deviceGatewayServiceAuth = (): MiddlewareHandler => async (c, next) => {
  const serviceToken = gatewayEnv.DEVICE_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    log('DEVICE_GATEWAY_SERVICE_TOKEN is not configured');
    return c.json({ error: 'Service not configured' }, 503);
  }

  if (c.req.header('authorization') !== `Bearer ${serviceToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
};

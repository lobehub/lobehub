import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { appEnv } from '@/envs/app';

const log = debug('lobe-server:agent:service-token-auth');

/**
 * Hono middleware that authenticates requests against
 * `AGENT_GATEWAY_SERVICE_TOKEN` via the `Authorization: Bearer <token>` header.
 *
 * Use for endpoints whose only trusted caller is the agent-gateway worker
 * (e.g. tool-result, finalize-abandoned). Mirror of the per-route check in
 * `app/(backend)/api/agent/tool-result/route.ts`.
 *
 * - Returns `503 Service not configured` when the env var is unset (matches
 *   the existing tool-result behavior — agent gateway should never be talking
 *   to a server with no token).
 * - Returns `401 Unauthorized` on header mismatch.
 */
export const serviceTokenAuth = (): MiddlewareHandler => async (c, next) => {
  const serviceToken = appEnv.AGENT_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    log('AGENT_GATEWAY_SERVICE_TOKEN is not configured');
    return c.json({ error: 'Service not configured' }, 503);
  }

  const authHeader = c.req.header('authorization');
  if (authHeader !== `Bearer ${serviceToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
};

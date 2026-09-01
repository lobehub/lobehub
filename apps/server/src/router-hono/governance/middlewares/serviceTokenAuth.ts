import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { appEnv } from '@/envs/app';

const log = debug('lobe-server:governance:service-token-auth');

/**
 * Hono middleware that authenticates requests against
 * `COMMAND_GOVERNANCE_SERVICE_TOKEN` via the `Authorization: Bearer <token>`
 * header.
 *
 * Trusted callers are the two sibling services implementing this contract:
 * the admin panel (rules CRUD + logs query) and the sandbox execution service
 * (`check` + `log`). Mirrors `router-hono/agent/middlewares/serviceTokenAuth.ts`.
 *
 * - Returns `503 Service not configured` when the env var is unset.
 * - Returns `401 Unauthorized` on header mismatch.
 */
export const serviceTokenAuth = (): MiddlewareHandler => async (c, next) => {
  const serviceToken = appEnv.COMMAND_GOVERNANCE_SERVICE_TOKEN;
  if (!serviceToken) {
    log('COMMAND_GOVERNANCE_SERVICE_TOKEN is not configured');
    return c.json({ error: 'Service not configured' }, 503);
  }

  const authHeader = c.req.header('authorization');
  if (authHeader !== `Bearer ${serviceToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
};

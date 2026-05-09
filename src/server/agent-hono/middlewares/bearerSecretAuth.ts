import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

const log = debug('lobe-server:agent:bearer-secret-auth');

/**
 * Hono middleware factory that requires `Authorization: Bearer <secret>`
 * matching a runtime-evaluated secret.
 *
 * - `getSecret` is invoked per request (do not capture the value at module
 *   load time — env vars may not be populated yet).
 * - Returns `503` when the secret is unset (matches the existing
 *   `serviceTokenAuth` behavior).
 * - Returns `401` on header mismatch.
 */
export const bearerSecretAuth =
  (getSecret: () => string | undefined): MiddlewareHandler =>
  async (c, next) => {
    const secret = getSecret();
    if (!secret) {
      log('Secret is not configured for %s', c.req.path);
      return c.json({ error: 'Service not configured' }, 503);
    }

    const authHeader = c.req.header('authorization');
    if (authHeader !== `Bearer ${secret}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  };

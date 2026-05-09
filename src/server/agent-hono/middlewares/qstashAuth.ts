import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { verifyQStashSignature } from '@/libs/qstash';

const log = debug('lobe-server:agent:qstash-auth');

/**
 * Hono middleware that requires a valid QStash signature on the request.
 *
 * The body is consumed via `c.req.text()` to compute the QStash HMAC;
 * downstream handlers can still call `c.req.json()` thanks to Hono's
 * bodyCache cross-conversion.
 */
export const qstashAuth = (): MiddlewareHandler => async (c, next) => {
  const rawBody = await c.req.text();
  const isValid = await verifyQStashSignature(c.req.raw, rawBody);

  if (!isValid) {
    log('Rejected: invalid QStash signature on %s', c.req.path);
    return c.json({ error: 'Invalid signature' }, 401);
  }

  await next();
};

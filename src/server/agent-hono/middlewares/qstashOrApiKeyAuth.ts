import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { verifyQStashSignature } from '@/libs/qstash';

const log = debug('lobe-server:agent:qstash-or-apikey-auth');

/**
 * Hono middleware that accepts either a valid QStash signature **or** a
 * matching `Authorization: Bearer <AGENT_EXEC_API_KEY>` token. Either passes.
 *
 * Mirrors the dual-path auth that lived inline in the old
 * `src/app/(backend)/api/agent/route.ts`. Used by `execAgent` so QStash
 * scheduled invocations and trusted external callers can both reach it.
 *
 * - When `AGENT_EXEC_API_KEY` is unset, the API-key path is disabled and
 *   only the QStash signature can authorize the request.
 * - The body is consumed via `c.req.text()` to compute the QStash HMAC;
 *   downstream handlers can still call `c.req.json()` thanks to Hono's
 *   bodyCache cross-conversion.
 */
export const qstashOrApiKeyAuth = (): MiddlewareHandler => async (c, next) => {
  const rawBody = await c.req.text();
  const isValidQStash = await verifyQStashSignature(c.req.raw, rawBody);

  const apiKey = process.env.AGENT_EXEC_API_KEY;
  let isValidApiKey = false;
  if (apiKey) {
    const authHeader = c.req.header('authorization');
    isValidApiKey = authHeader === `Bearer ${apiKey}`;
  }

  if (!isValidQStash && !isValidApiKey) {
    log('Rejected: neither QStash sig nor API key matched on %s', c.req.path);
    return c.json({ error: 'Unauthorized - Valid QStash signature or API key required' }, 401);
  }

  await next();
};

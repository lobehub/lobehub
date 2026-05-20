import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { verifyQStashSignature } from '@/libs/qstash';

const log = debug('lobe-server:workflows:qstash-auth');

/**
 * Hono middleware that verifies the `Upstash-Signature` header on incoming
 * QStash webhook calls.
 *
 * - When `QSTASH_CURRENT_SIGNING_KEY` is unset (dev / electron), verification
 *   is skipped — matching the existing `verifyQStashSignature` behavior.
 * - On signature mismatch, returns `401 Invalid signature` and aborts the
 *   handler chain.
 * - The body is consumed via `c.req.text()` to compute the HMAC; downstream
 *   handlers can still call `c.req.json()` because Hono caches across body
 *   formats (`bodyCache` cross-converts text ↔ json).
 *
 * Use for one-shot QStash webhook receivers. For Upstash *Workflow* endpoints
 * (multi-step `serve()` integrations) use `@upstash/workflow/hono`'s built-in
 * verification instead.
 */
export const qstashAuth = (): MiddlewareHandler => async (c, next) => {
  if (process.env.QSTASH_CURRENT_SIGNING_KEY) {
    const rawBody = await c.req.text();
    const ok = await verifyQStashSignature(c.req.raw, rawBody);
    if (!ok) {
      log('Rejected: invalid QStash signature on %s', c.req.path);
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }
  await next();
};

import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { verifyQStashSignature } from '@/libs/qstash';

const log = debug('lobe-server:agent:qstash-or-apikey-auth');

// Simple in-process rate limiter for API-key authenticated requests.
// Keyed by client IP; resets every RATE_WINDOW_MS milliseconds.
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20; // max requests per window per IP
const apiKeyRateCounts = new Map<string, { count: number; resetAt: number }>();

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

  // Apply rate limiting only on the API-key path (QStash is already throttled by the service).
  if (isValidApiKey && !isValidQStash) {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    const now = Date.now();
    const entry = apiKeyRateCounts.get(ip);
    if (!entry || now > entry.resetAt) {
      apiKeyRateCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    } else if (entry.count >= RATE_LIMIT_MAX) {
      log('Rate limit exceeded for IP %s on %s', ip, c.req.path);
      return c.json({ error: 'Too Many Requests' }, 429);
    } else {
      entry.count += 1;
    }
  }

  await next();
};

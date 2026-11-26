import type { Context, Next } from 'hono';

import { redisService } from '@/server/services/redis';

import { renderApiError } from '../common/errors';
import { logFailOpen } from '../helpers/fail-open-log';

export const RATE_LIMIT_HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  reset: 'X-RateLimit-Reset',
  retryAfter: 'Retry-After',
} as const;

export interface RateLimitPolicy {
  /** Separates counters, so a stricter route limit never spends the default one. */
  bucket: string;
  limit: number;
  windowSeconds: number;
}

const readLimit = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** The limit every API-key request shares; `OPENAPI_RATE_LIMIT_PER_MINUTE` overrides it. */
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  bucket: 'default',
  limit: readLimit(process.env.OPENAPI_RATE_LIMIT_PER_MINUTE, 600),
  windowSeconds: 60,
};

/** Requests are counted per API key; other credentials (OIDC, operation JWTs) are not limited. */
const rateLimitIdentity = (c: Context): string | undefined => {
  if (c.get('authType') !== 'apikey') return;
  const apiKeyId = (c.get('authData') as { apiKeyId?: number | string } | null)?.apiKeyId;
  return apiKeyId === undefined || apiKeyId === null ? undefined : `key:${apiKeyId}`;
};

const setHeaders = (c: Context, headers: Record<string, string>) => {
  for (const [name, value] of Object.entries(headers)) c.header(name, value);
};

/**
 * Fixed-window rate limit per API key, counted in Redis through
 * `redisService.openapi`. Every limited response carries
 * `X-RateLimit-Limit/Remaining/Reset` (reset is a Unix time in seconds); a
 * refused one answers 429 `rate_limited` with `Retry-After` in seconds.
 * Without Redis the request is admitted without headers.
 */
export const rateLimit =
  (policy: RateLimitPolicy = DEFAULT_RATE_LIMIT_POLICY) =>
  async (c: Context, next: Next) => {
    const identity = rateLimitIdentity(c);
    if (!identity) return next();

    const window = await redisService.openapi
      .hitRateLimit({ ...policy, identity })
      .catch((error) => {
        logFailOpen('rate limit', error);
        return undefined;
      });
    if (!window) return next();

    const headers = {
      [RATE_LIMIT_HEADERS.limit]: String(window.limit),
      [RATE_LIMIT_HEADERS.remaining]: String(window.remaining),
      [RATE_LIMIT_HEADERS.reset]: String(window.resetAt),
    };
    setHeaders(c, headers);

    if (!window.allowed) {
      const retryAfter = Math.max(1, window.resetAt - Math.floor(Date.now() / 1000));
      c.header(RATE_LIMIT_HEADERS.retryAfter, String(retryAfter));
      return renderApiError(c, {
        code: 'rate_limited',
        message: `Rate limit of ${window.limit} requests per ${policy.windowSeconds}s exceeded for this API key; retry after ${retryAfter}s`,
        status: 429,
      });
    }

    await next();

    // A handler that returns a raw `Response` skips the prepared headers.
    for (const [name, value] of Object.entries(headers)) {
      if (!c.res.headers.has(name)) {
        try {
          c.res.headers.set(name, value);
        } catch {
          // Immutable upstream headers: the limit still applied, only the hint is lost.
        }
      }
    }
  };

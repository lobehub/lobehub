import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('openapi');

/** How long a stored first response answers replays of its `Idempotency-Key`. */
export const IDEMPOTENCY_RECORD_TTL_SECONDS = 24 * 60 * 60;
/**
 * How long an in-flight claim blocks a concurrent replay. Short, so a request
 * whose process died mid-flight frees its key instead of holding it for a day.
 */
export const IDEMPOTENCY_PENDING_TTL_SECONDS = 5 * 60;

export interface RateLimitWindow {
  /** Whether this request fits in the window. */
  allowed: boolean;
  /** Requests admitted per window. */
  limit: number;
  /** Requests still admitted in the current window (never negative). */
  remaining: number;
  /** Unix time (seconds) the current window ends. */
  resetAt: number;
}

/** The first response to an idempotent request, replayed for its key. */
export interface IdempotentResponseRecord {
  body: string;
  contentType: string | null;
  status: number;
}

type IdempotencyEntry =
  | { fingerprint: string; state: 'pending' }
  | { fingerprint: string; response: IdempotentResponseRecord; state: 'completed' };

export type IdempotencyClaim =
  | { state: 'claimed' }
  | { state: 'pending'; sameRequest: boolean }
  | { response: IdempotentResponseRecord; sameRequest: boolean; state: 'completed' };

const parseEntry = (raw: string | null): IdempotencyEntry | undefined => {
  if (!raw) return;
  try {
    return JSON.parse(raw) as IdempotencyEntry;
  } catch {
    return;
  }
};

export const openapi = {
  /**
   * Counts one request against a caller's fixed window for a bucket. Windows
   * are aligned to the epoch, so every instance agrees on when one resets.
   * The window key is created with its expiry before the increment, so a
   * crash between the two never leaves a counter without one. `undefined`
   * without Redis: the REST layer then admits the request.
   */
  async hitRateLimit(scope: {
    bucket: string;
    identity: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitWindow | undefined> {
    const redis = await getClient();
    if (!redis) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = nowSeconds - (nowSeconds % scope.windowSeconds);
    const resetAt = windowStart + scope.windowSeconds;
    const key = RedisKeys.openapi.rateLimit(scope.identity, scope.bucket, windowStart);

    await redis.set(key, '0', { ex: scope.windowSeconds + 1, nx: true });
    const count = await redis.incr(key);

    return {
      allowed: count <= scope.limit,
      limit: scope.limit,
      remaining: Math.max(0, scope.limit - count),
      resetAt,
    };
  },

  /**
   * Claims a user's `Idempotency-Key` for one request. The first caller gets
   * `claimed` and must later `completeIdempotency` or `releaseIdempotency`;
   * later callers see the in-flight claim or the stored first response, and
   * whether their request (by `fingerprint`) is the one that key was first
   * used for. `undefined` without Redis: the request then runs unguarded.
   */
  async claimIdempotency(scope: {
    fingerprint: string;
    keyHash: string;
    userId: string;
  }): Promise<IdempotencyClaim | undefined> {
    const redis = await getClient();
    if (!redis) return;

    const key = RedisKeys.openapi.idempotency(scope.userId, scope.keyHash);
    const pending: IdempotencyEntry = { fingerprint: scope.fingerprint, state: 'pending' };
    const claimed = await redis.set(key, JSON.stringify(pending), {
      ex: IDEMPOTENCY_PENDING_TTL_SECONDS,
      nx: true,
    });
    if (claimed) return { state: 'claimed' };

    const entry = parseEntry(await redis.get(key));
    // Expired between the two calls, or unreadable: treat as still in flight
    // rather than run the request a second time.
    if (!entry) return { sameRequest: true, state: 'pending' };

    const sameRequest = entry.fingerprint === scope.fingerprint;
    return entry.state === 'completed'
      ? { response: entry.response, sameRequest, state: 'completed' }
      : { sameRequest, state: 'pending' };
  },

  /** Stores the first response for the key, replayed for the next 24 hours. */
  async completeIdempotency(
    scope: { fingerprint: string; keyHash: string; userId: string },
    response: IdempotentResponseRecord,
  ) {
    const redis = await getClient();
    if (!redis) return;

    const entry: IdempotencyEntry = {
      fingerprint: scope.fingerprint,
      response,
      state: 'completed',
    };
    await redis.set(
      RedisKeys.openapi.idempotency(scope.userId, scope.keyHash),
      JSON.stringify(entry),
      {
        ex: IDEMPOTENCY_RECORD_TTL_SECONDS,
      },
    );
  },

  /** Frees a claim whose request should be retryable (server error, stream). */
  async releaseIdempotency(scope: { keyHash: string; userId: string }) {
    const redis = await getClient();
    if (!redis) return;

    await redis.del(RedisKeys.openapi.idempotency(scope.userId, scope.keyHash));
  },
};

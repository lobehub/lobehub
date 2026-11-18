import { randomUUID } from 'node:crypto';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('openapi');

/** How long a stored first response answers replays of its `Idempotency-Key`. */
export const IDEMPOTENCY_RECORD_TTL_SECONDS = 24 * 60 * 60;
/**
 * How long an in-flight claim blocks a concurrent replay. Short, so a request
 * whose process died mid-flight frees its key instead of holding it for a day.
 * A request still running past it loses its claim: a retry then runs again,
 * and the first request's late completion no longer writes over the retry's.
 */
export const IDEMPOTENCY_PENDING_TTL_SECONDS = 5 * 60;

/**
 * One round trip per counted request: the first hit of a window sets its
 * expiry in the same atomic step, so a counter never outlives its window.
 *
 * KEYS[1] = window key; ARGV[1] = ttl seconds
 */
const HIT_RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

/**
 * Applies a write only while the key still holds the caller's own claim, so a
 * request that outlived its claim cannot overwrite or delete another's.
 *
 * KEYS[1] = idempotency key; ARGV[1] = claim token; ARGV[2] = 'del' | value;
 * ARGV[3] = ttl seconds (for a value)
 */
const OWNED_CLAIM_WRITE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, entry = pcall(cjson.decode, raw)
if not ok or entry.state ~= 'pending' or entry.token ~= ARGV[1] then return 0 end
if ARGV[2] == 'del' then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
end
return 1
`;

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
  /**
   * How `body` was serialized. `base64` keeps binary answers (audio, images)
   * byte-exact; records without it are plain text written before that change.
   */
  encoding?: 'base64';
  status: number;
}

type IdempotencyEntry =
  | { fingerprint: string; state: 'pending'; token: string }
  | { fingerprint: string; response: IdempotentResponseRecord; state: 'completed' };

export type IdempotencyClaim =
  | { state: 'claimed'; token: string }
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
   * One atomic script per request (see {@link HIT_RATE_LIMIT_SCRIPT}).
   * `undefined` without Redis: the REST layer then admits the request.
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

    const count = Number(
      await redis.eval<number>(HIT_RATE_LIMIT_SCRIPT, 1, key, scope.windowSeconds + 1),
    );

    return {
      allowed: count <= scope.limit,
      limit: scope.limit,
      remaining: Math.max(0, scope.limit - count),
      resetAt,
    };
  },

  /**
   * Claims a user's `Idempotency-Key` for one request. The first caller gets
   * `claimed` with a token, and must later `completeIdempotency` or
   * `releaseIdempotency` with it;
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
    const token = randomUUID();
    const pending: IdempotencyEntry = { fingerprint: scope.fingerprint, state: 'pending', token };
    const claimed = await redis.set(key, JSON.stringify(pending), {
      ex: IDEMPOTENCY_PENDING_TTL_SECONDS,
      nx: true,
    });
    if (claimed) return { state: 'claimed', token };

    const entry = parseEntry(await redis.get(key));
    // Expired between the two calls, or unreadable: treat as still in flight
    // rather than run the request a second time.
    if (!entry) return { sameRequest: true, state: 'pending' };

    const sameRequest = entry.fingerprint === scope.fingerprint;
    return entry.state === 'completed'
      ? { response: entry.response, sameRequest, state: 'completed' }
      : { sameRequest, state: 'pending' };
  },

  /**
   * Stores the first response for the key, replayed for the next 24 hours.
   * Writes only while the caller's claim (`token`) still holds the key.
   */
  async completeIdempotency(
    scope: { fingerprint: string; keyHash: string; token: string; userId: string },
    response: IdempotentResponseRecord,
  ) {
    const redis = await getClient();
    if (!redis) return;

    const entry: IdempotencyEntry = {
      fingerprint: scope.fingerprint,
      response,
      state: 'completed',
    };
    await redis.eval(
      OWNED_CLAIM_WRITE_SCRIPT,
      1,
      RedisKeys.openapi.idempotency(scope.userId, scope.keyHash),
      scope.token,
      JSON.stringify(entry),
      IDEMPOTENCY_RECORD_TTL_SECONDS,
    );
  },

  /** Frees the caller's own claim so the request can be retried (server error, stream). */
  async releaseIdempotency(scope: { keyHash: string; token: string; userId: string }) {
    const redis = await getClient();
    if (!redis) return;

    await redis.eval(
      OWNED_CLAIM_WRITE_SCRIPT,
      1,
      RedisKeys.openapi.idempotency(scope.userId, scope.keyHash),
      scope.token,
      'del',
    );
  },
};

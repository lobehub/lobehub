import { randomInt } from 'node:crypto';

import debug from 'debug';
import type Redis from 'ioredis';

import type { BotReplyLocale } from './platforms';

const log = debug('lobe-server:bot:dm-pairing-store');

/**
 * One pairing request lives in Redis for an hour. Long enough that an owner
 * can take a meal-break before approving, short enough that abandoned codes
 * don't pile up indefinitely.
 */
export const PAIRING_TTL_SECONDS = 3600;

/**
 * Per-bot ceiling on simultaneously pending requests. The owner is the
 * funnel — too many open codes means the owner can't realistically triage,
 * and the bot becomes a spam attractor. 50 is a generous upper bound: a
 * legitimate bot rarely sees that many fresh strangers per hour.
 */
export const PAIRING_MAX_PENDING_PER_BOT = 50;

/**
 * How long a single `/approve` handler is granted exclusive access to a
 * code after `peekPairingRequest` returns. Long enough to cover normal DB
 * persistence; short enough that a crashed handler doesn't permanently
 * block the operator from retrying.
 */
const PAIRING_CLAIM_TTL_SECONDS = 60;

/**
 * Crockford Base32 alphabet (no I/L/O/U, no 0/1) — chosen because the code
 * gets eyeballed and re-typed, and the standard base32 set produces too
 * many lookalikes (`0/O`, `1/I/L`). 8 characters from a 30-symbol alphabet
 * give >38 bits of entropy, which is enough that brute-forcing a code in
 * the 1-hour TTL window is infeasible at any realistic request rate.
 */
const CROCKFORD_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 8;

/** Public applicant info captured at request time. */
export interface PairingApplicant {
  /** The applicant's platform user ID — what gets appended to allowFrom. */
  applicantUserId: string;
  /** Optional operator-facing label (the platform user's display name). */
  applicantUserName?: string;
  /**
   * Locale to use when notifying the applicant after approval. Captured at
   * request time because the owner runs `/approve` in their own context,
   * which may not match the applicant's language.
   */
  replyLocale: BotReplyLocale;
  /** Composite platformThreadId for the applicant's DM — where the
   *  approval notification gets posted. */
  threadId: string;
}

/** Persisted pending request — applicant + bot-scoping fields. */
export interface PairingEntry extends PairingApplicant {
  applicationId: string;
  code: string;
  /** Wall-clock millis at creation, used for diagnostic logging. */
  createdAt: number;
  platform: string;
}

export type CreatePairingResult =
  | { code: string; reused: boolean; status: 'created' | 'reused' }
  | { status: 'capacity-exceeded' | 'redis-unavailable' };

/**
 * Generate a fresh pairing code. Uses `crypto.randomInt` (CSPRNG with
 * rejection sampling) rather than `Math.random` because the code gates
 * write access to allowFrom — predictable codes would let a stranger
 * preempt the owner's approval. `randomInt` is preferred over
 * `randomBytes() % N` because the alphabet length (30) doesn't divide 256
 * evenly, so a naive modulo would bias toward earlier characters.
 */
export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  }
  return code;
}

const codeKey = (platform: string, applicationId: string, code: string): string =>
  `bot:dm-pairing:code:${platform}:${applicationId}:${code}`;

const applicantKey = (platform: string, applicationId: string, applicantUserId: string): string =>
  `bot:dm-pairing:applicant:${platform}:${applicationId}:${applicantUserId}`;

const activeSetKey = (platform: string, applicationId: string): string =>
  `bot:dm-pairing:active:${platform}:${applicationId}`;

const claimKey = (platform: string, applicationId: string, code: string): string =>
  `bot:dm-pairing:claim:${platform}:${applicationId}:${code}`;

/**
 * Create a pending pairing request, or return the applicant's existing one
 * if they already have one outstanding.
 *
 * The applicant index (`applicantKey`) makes a re-DM idempotent: a stranger
 * who pings the bot twice in a row sees the same code rather than receiving
 * a fresh one each time and confusing their owner with stale codes. The
 * active-set check (`activeSetKey`) caps the per-bot workload so a flood of
 * distinct fake accounts can't drown the owner.
 *
 * Returns `'redis-unavailable'` (no Redis client wired) or
 * `'capacity-exceeded'` (cap hit) without state change so the caller can
 * surface a useful message instead of silently dropping the applicant.
 */
export async function createOrGetPairingRequest(params: {
  applicant: PairingApplicant;
  applicationId: string;
  platform: string;
  redis: Redis | null;
}): Promise<CreatePairingResult> {
  const { applicant, applicationId, platform, redis } = params;

  if (!redis) {
    log('createOrGetPairingRequest: redis unavailable — skipping');
    return { status: 'redis-unavailable' };
  }

  const aKey = applicantKey(platform, applicationId, applicant.applicantUserId);
  const sKey = activeSetKey(platform, applicationId);

  // Same applicant within the TTL window → reuse their code (don't make
  // them stack codes if they DM again).
  const existingCode = await redis.get(aKey);
  if (existingCode) {
    const entry = await redis.get(codeKey(platform, applicationId, existingCode));
    if (entry) {
      log(
        'createOrGetPairingRequest: reuse existing code for applicant=%s, platform=%s, app=%s',
        applicant.applicantUserId,
        platform,
        applicationId,
      );
      return { code: existingCode, reused: true, status: 'reused' };
    }
    // Index pointed to an expired code — fall through and mint a fresh one.
  }

  // The active set is a ZSET scored by per-entry expiry. Codes only get
  // SREM'd on explicit approval, so codes that expire naturally (the
  // common case for abandoned requests) would otherwise linger and wedge
  // the capacity gate at 50 forever. Drop the dead members before counting.
  const createdAt = Date.now();
  const expiresAt = createdAt + PAIRING_TTL_SECONDS * 1000;
  await redis.zremrangebyscore(sKey, 0, createdAt);

  const activeCount = await redis.zcard(sKey);
  if (activeCount >= PAIRING_MAX_PENDING_PER_BOT) {
    log(
      'createOrGetPairingRequest: capacity %d/%d exceeded for platform=%s, app=%s',
      activeCount,
      PAIRING_MAX_PENDING_PER_BOT,
      platform,
      applicationId,
    );
    return { status: 'capacity-exceeded' };
  }

  // Mint a fresh code, retrying on the (astronomically unlikely) collision.
  let code = generatePairingCode();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const exists = await redis.exists(codeKey(platform, applicationId, code));
    if (!exists) break;
    code = generatePairingCode();
  }

  const entry: PairingEntry = {
    applicantUserId: applicant.applicantUserId,
    applicantUserName: applicant.applicantUserName,
    applicationId,
    code,
    createdAt,
    platform,
    replyLocale: applicant.replyLocale,
    threadId: applicant.threadId,
  };

  await redis
    .multi()
    .set(codeKey(platform, applicationId, code), JSON.stringify(entry), 'EX', PAIRING_TTL_SECONDS)
    .set(aKey, code, 'EX', PAIRING_TTL_SECONDS)
    .zadd(sKey, expiresAt, code)
    .expire(sKey, PAIRING_TTL_SECONDS)
    .exec();

  log(
    'createOrGetPairingRequest: created code for applicant=%s, platform=%s, app=%s',
    applicant.applicantUserId,
    platform,
    applicationId,
  );

  return { code, reused: false, status: 'created' };
}

/**
 * Look up a pending request by code, taking a single-winner claim on it
 * for the duration of the caller's downstream work.
 *
 * Returns the persisted `PairingEntry`, or `null` when the code is
 * unknown / expired / malformed, or when another caller already holds
 * the claim (the GET/MULTI-DEL split would otherwise race: two concurrent
 * `/approve` calls could both read the entry before either's cleanup
 * runs and end up sending duplicate approvals to the applicant).
 *
 * The entry itself is left in Redis so the caller can pair this with
 * `deletePairingRequest` (on success) or `releasePairingClaim` (on
 * persistence failure, so the operator can retry without forcing the
 * applicant to mint a new code). The claim auto-expires after
 * `PAIRING_CLAIM_TTL_SECONDS` so a crashed handler doesn't permanently
 * block retry.
 */
export async function peekPairingRequest(params: {
  applicationId: string;
  code: string;
  platform: string;
  redis: Redis | null;
}): Promise<PairingEntry | null> {
  const { applicationId, code, platform, redis } = params;
  if (!redis) return null;

  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  const cKey = codeKey(platform, applicationId, normalized);
  const lockKey = claimKey(platform, applicationId, normalized);

  // Atomic single-winner claim. SET NX returns null when the lock is
  // already held — the loser bails out as if the code didn't exist
  // (which from their perspective it effectively doesn't, because a
  // peer is mid-approval).
  const acquired = await redis.set(lockKey, '1', 'EX', PAIRING_CLAIM_TTL_SECONDS, 'NX');
  if (!acquired) {
    log('peekPairingRequest: lost claim race for code=%s', normalized);
    return null;
  }

  const raw = await redis.get(cKey);
  if (!raw) {
    // Code expired or never existed — release the claim immediately so
    // the next caller doesn't sit behind a phantom lock for 60s.
    await redis.del(lockKey);
    return null;
  }

  try {
    return JSON.parse(raw) as PairingEntry;
  } catch (error) {
    log('peekPairingRequest: failed to parse entry for code=%s: %O', normalized, error);
    // Malformed entries can never be approved — drop them so they don't
    // sit around forever consuming a slot in the active set, and clear
    // our own claim while we're at it.
    await redis
      .multi()
      .del(cKey)
      .del(lockKey)
      .zrem(activeSetKey(platform, applicationId), normalized)
      .exec();
    return null;
  }
}

/**
 * Release the peek claim without removing the underlying entry. Used
 * when downstream persistence fails: the operator should be able to
 * retry `/approve` immediately rather than waiting out the claim TTL.
 */
export async function releasePairingClaim(params: {
  applicationId: string;
  code: string;
  platform: string;
  redis: Redis | null;
}): Promise<void> {
  const { applicationId, code, platform, redis } = params;
  if (!redis) return;

  const normalized = code.trim().toUpperCase();
  if (!normalized) return;

  await redis.del(claimKey(platform, applicationId, normalized));
}

/**
 * Tear down all bookkeeping for a pairing request once it has been
 * successfully approved (or otherwise resolved). Idempotent: a second
 * call after the keys are gone is a no-op against Redis.
 */
export async function deletePairingRequest(params: {
  applicationId: string;
  applicantUserId: string;
  code: string;
  platform: string;
  redis: Redis | null;
}): Promise<void> {
  const { applicationId, applicantUserId, code, platform, redis } = params;
  if (!redis) return;

  const normalized = code.trim().toUpperCase();
  if (!normalized) return;

  await redis
    .multi()
    .del(codeKey(platform, applicationId, normalized))
    .del(applicantKey(platform, applicationId, applicantUserId))
    .del(claimKey(platform, applicationId, normalized))
    .zrem(activeSetKey(platform, applicationId), normalized)
    .exec();

  log(
    'deletePairingRequest: cleared code for applicant=%s, platform=%s, app=%s',
    applicantUserId,
    platform,
    applicationId,
  );
}

/**
 * Claim a pending request by code and remove its bookkeeping.
 *
 * Returns the persisted `PairingEntry` so callers can act on the
 * applicant's identity / thread / locale, or `null` when the code is
 * unknown / expired / already consumed / lost to a concurrent caller.
 * Atomicity is enforced by `peekPairingRequest`'s claim lock — two
 * simultaneous `/approve`s for the same code see only one winner.
 *
 * Prefer `peekPairingRequest` + `deletePairingRequest` (with
 * `releasePairingClaim` on failure) when downstream persistence can
 * fail — consuming the code before persistence loses the code on a
 * transient error.
 */
export async function consumePairingRequest(params: {
  applicationId: string;
  code: string;
  platform: string;
  redis: Redis | null;
}): Promise<PairingEntry | null> {
  const entry = await peekPairingRequest(params);
  if (!entry) return null;

  await deletePairingRequest({
    applicationId: params.applicationId,
    applicantUserId: entry.applicantUserId,
    code: params.code,
    platform: params.platform,
    redis: params.redis,
  });

  return entry;
}

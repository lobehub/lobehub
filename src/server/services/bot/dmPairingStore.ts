import { randomBytes } from 'node:crypto';

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
 * Generate a fresh pairing code. Uses `crypto.randomBytes` (CSPRNG) rather
 * than `Math.random` because the code gates write access to allowFrom —
 * predictable codes would let a stranger preempt the owner's approval.
 */
export function generatePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CROCKFORD_ALPHABET[bytes[i] % CROCKFORD_ALPHABET.length];
  }
  return code;
}

const codeKey = (platform: string, applicationId: string, code: string): string =>
  `bot:dm-pairing:code:${platform}:${applicationId}:${code}`;

const applicantKey = (platform: string, applicationId: string, applicantUserId: string): string =>
  `bot:dm-pairing:applicant:${platform}:${applicationId}:${applicantUserId}`;

const activeSetKey = (platform: string, applicationId: string): string =>
  `bot:dm-pairing:active:${platform}:${applicationId}`;

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

  const activeCount = await redis.scard(sKey);
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
    createdAt: Date.now(),
    platform,
    replyLocale: applicant.replyLocale,
    threadId: applicant.threadId,
  };

  await redis
    .multi()
    .set(codeKey(platform, applicationId, code), JSON.stringify(entry), 'EX', PAIRING_TTL_SECONDS)
    .set(aKey, code, 'EX', PAIRING_TTL_SECONDS)
    .sadd(sKey, code)
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
 * Atomically claim a pending request by code and remove its bookkeeping.
 *
 * Returns the persisted `PairingEntry` so callers can act on the
 * applicant's identity / thread / locale, or `null` when the code is
 * unknown / expired / already consumed. Two simultaneous `/approve`s for
 * the same code are safe: only one returns the entry; the other gets
 * `null` because the cleanup multi has already run.
 */
export async function consumePairingRequest(params: {
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
  const raw = await redis.get(cKey);
  if (!raw) return null;

  let entry: PairingEntry;
  try {
    entry = JSON.parse(raw) as PairingEntry;
  } catch (error) {
    log('consumePairingRequest: failed to parse entry for code=%s: %O', normalized, error);
    await redis.del(cKey);
    return null;
  }

  await redis
    .multi()
    .del(cKey)
    .del(applicantKey(platform, applicationId, entry.applicantUserId))
    .srem(activeSetKey(platform, applicationId), normalized)
    .exec();

  log(
    'consumePairingRequest: consumed code for applicant=%s, platform=%s, app=%s',
    entry.applicantUserId,
    platform,
    applicationId,
  );

  return entry;
}

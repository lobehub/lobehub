import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { getMessengerLinkTokenTtl, type MessengerPlatform } from '@/config/messenger';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:messenger:link-token');

/** Lower-cased random token used as the URL `random_id` query param. */
export type LinkToken = string;

export interface LinkTokenPayload {
  createdAt: number;
  platform: MessengerPlatform;
  platformUserId: string;
  /** Best-effort display name shown on the verify-im confirm screen. */
  platformUsername?: string;
  /**
   * Per-tenant install id this link belongs to. Slack `team_id` (or
   * `enterprise_id` for Grid org installs) — written into
   * `messenger_account_links.tenant_id` on confirm so the router knows which
   * workspace's bot to dispatch to. Empty / undefined for global-bot
   * platforms (Telegram).
   */
  tenantId?: string;
  /**
   * Human-readable workspace / tenant name (e.g. `"Acme Inc"`) so the
   * verify-im page can render "Linking <user> in **Acme Inc** workspace"
   * without a server-side `team.info` round-trip.
   */
  tenantName?: string;
}

const tokenKey = (token: LinkToken): string => `messenger:link-token:${token}`;

/** Existing token reuse map — same `(platform, platformUserId)` shouldn't
 * generate a fresh token each /start; reuse the live one if it hasn't expired
 * so the user's previous "Link Account" button still works. */
const reuseKey = (platform: MessengerPlatform, platformUserId: string): string =>
  `messenger:link-token-reuse:${platform}:${platformUserId}`;

/** Marker written when a token is consumed via `confirmLink`. Lets the
 * verify-im page distinguish "token expired" (TTL ran out before binding)
 * from "binding succeeded earlier" (token was deliberately consumed) when
 * the user later refreshes or revisits the URL. */
const consumedKey = (token: LinkToken): string => `messenger:link-token-consumed:${token}`;

/** TTL for the "consumed" marker. Picked to comfortably outlive the active
 * token TTL so a refresh after binding still resolves to a "consumed" hit
 * instead of a misleading "expired" message. */
const CONSUMED_MARKER_TTL_SECONDS = 24 * 60 * 60;

export interface ConsumedLinkTokenMarker {
  consumedAt: number;
  platform: MessengerPlatform;
  tenantId?: string;
}

/**
 * Issue a one-shot link token bound to a platform user. If a live token already
 * exists for the same `(platform, platformUserId)`, return it instead of
 * minting a new one.
 */
export const issueLinkToken = async (
  payload: Omit<LinkTokenPayload, 'createdAt'>,
): Promise<LinkToken> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    throw new Error('Redis is required for messenger link token storage');
  }

  const ttl = getMessengerLinkTokenTtl();
  const existing = await redis.get(reuseKey(payload.platform, payload.platformUserId));
  if (existing) {
    const live = await redis.get(tokenKey(existing));
    if (live) {
      log(
        'issueLinkToken: reusing existing token for %s:%s',
        payload.platform,
        payload.platformUserId,
      );
      return existing;
    }
  }

  const token = randomUUID().replaceAll('-', '');
  const value: LinkTokenPayload = { ...payload, createdAt: Date.now() };

  await redis.set(tokenKey(token), JSON.stringify(value), 'EX', ttl);
  await redis.set(reuseKey(payload.platform, payload.platformUserId), token, 'EX', ttl);

  log(
    'issueLinkToken: issued token for %s:%s ttl=%ds',
    payload.platform,
    payload.platformUserId,
    ttl,
  );
  return token;
};

export const peekLinkToken = async (token: LinkToken): Promise<LinkTokenPayload | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(tokenKey(token));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as LinkTokenPayload;
  } catch {
    return null;
  }
};

export const consumeLinkToken = async (token: LinkToken): Promise<LinkTokenPayload | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(tokenKey(token));
  if (!raw) return null;

  let payload: LinkTokenPayload;
  try {
    payload = JSON.parse(raw) as LinkTokenPayload;
  } catch {
    await redis.del(tokenKey(token));
    return null;
  }

  await redis.del(tokenKey(token));
  await redis.del(reuseKey(payload.platform, payload.platformUserId));

  const marker: ConsumedLinkTokenMarker = {
    consumedAt: Date.now(),
    platform: payload.platform,
    tenantId: payload.tenantId,
  };
  await redis.set(consumedKey(token), JSON.stringify(marker), 'EX', CONSUMED_MARKER_TTL_SECONDS);

  return payload;
};

/**
 * Read the "consumed" marker for a token. Returns null when the token was
 * never consumed (or the marker has itself expired). Used by the verify-im
 * peek endpoint to tell the user whether their binding already succeeded.
 */
export const peekConsumedLinkToken = async (
  token: LinkToken,
): Promise<ConsumedLinkTokenMarker | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(consumedKey(token));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ConsumedLinkTokenMarker;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Web-initiated link codes.
//
// The link token above is minted by the IM side (the bot learns a platform
// user id first, the web page binds it). Carrier platforms (Linq iMessage /
// SMS) run the other way round: the signed-in web user asks for a code, then
// texts it from their phone to a shared pool number. The inbound sender is the
// identity being linked, so the code has to remember the LobeHub side instead.
// ---------------------------------------------------------------------------

/** One-time code a person sends from the IM side, e.g. `LH-7Q2M4XKP`. */
export type LinkCode = string;

export interface LinkCodePayload {
  /** Agent the first inbound message lands on once the link exists. */
  activeAgentId: string | null;
  createdAt: number;
  platform: MessengerPlatform;
  /** Opaque id the web page polls; never reveals the code itself. */
  pollId: string;
  userId: string;
  workspaceId: string | null;
}

export type LinkCodePollStatus =
  | { status: 'pending' }
  | { linkedAt: number; platformUserId: string; status: 'linked' }
  | { reason: 'already_linked_to_other' | 'unlink_before_relink'; status: 'failed' };

interface LinkCodePollRecord {
  code: LinkCode;
  platform: MessengerPlatform;
  result: LinkCodePollStatus;
  userId: string;
}

const linkCodeKey = (code: LinkCode): string => `messenger:link-code:${code.toUpperCase()}`;
const linkCodeReuseKey = (platform: MessengerPlatform, userId: string): string =>
  `messenger:link-code-reuse:${platform}:${userId}`;
const linkCodePollKey = (pollId: string): string => `messenger:link-code-poll:${pollId}`;

const requireRedis = () => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required for messenger link code storage');
  return redis;
};

/**
 * Issue (or reuse) a link code for a signed-in user. `mintCode` is injected so
 * each platform keeps its own code format — Linq codes are `LH-` prefixed so
 * they survive being embedded in an arbitrary message body.
 *
 * A live code for the same `(platform, userId)` is returned again with its
 * remaining TTL, so reopening the connect page does not invalidate the link
 * the person may already have sent from their phone.
 */
export const issueLinkCode = async (
  params: Omit<LinkCodePayload, 'createdAt' | 'pollId'> & { mintCode: () => LinkCode },
): Promise<{ code: LinkCode; expiresAt: number; pollId: string }> => {
  const redis = requireRedis();
  const { mintCode, ...payload } = params;

  const existing = await redis.get(linkCodeReuseKey(payload.platform, payload.userId));
  if (existing) {
    const raw = await redis.get(linkCodeKey(existing));
    const ttl = raw ? await redis.ttl(linkCodeKey(existing)) : -2;
    if (raw && ttl > 0) {
      try {
        const live = JSON.parse(raw) as LinkCodePayload;
        // Re-pin the agent the user just picked; the code itself stays.
        const updated: LinkCodePayload = {
          ...live,
          activeAgentId: payload.activeAgentId,
          workspaceId: payload.workspaceId,
        };
        await redis.set(linkCodeKey(existing), JSON.stringify(updated), 'EX', ttl);
        return { code: existing, expiresAt: Date.now() + ttl * 1000, pollId: live.pollId };
      } catch {
        // Corrupt entry — fall through and mint a fresh one.
      }
    }
  }

  const ttl = getMessengerLinkTokenTtl();
  const code = mintCode().toUpperCase();
  const pollId = randomUUID().replaceAll('-', '');
  const value: LinkCodePayload = { ...payload, createdAt: Date.now(), pollId };
  const poll: LinkCodePollRecord = {
    code,
    platform: payload.platform,
    result: { status: 'pending' },
    userId: payload.userId,
  };

  // NX: a collision with a live code is astronomically unlikely, but it must
  // never silently hand someone else's pending code a new owner.
  const created = await redis.set(linkCodeKey(code), JSON.stringify(value), 'EX', ttl, 'NX');
  if (created !== 'OK') throw new Error('Link code collision, retry');
  await redis.set(linkCodeReuseKey(payload.platform, payload.userId), code, 'EX', ttl);
  // The poll record outlives the code so a page polling right at expiry still
  // sees the `linked` outcome instead of a misleading `expired`.
  await redis.set(
    linkCodePollKey(pollId),
    JSON.stringify(poll),
    'EX',
    ttl + CONSUMED_MARKER_TTL_SECONDS,
  );

  log('issueLinkCode: issued %s code for user=%s ttl=%ds', payload.platform, payload.userId, ttl);
  return { code, expiresAt: Date.now() + ttl * 1000, pollId };
};

/**
 * Atomically take a link code. Only the first inbound carrying the code gets
 * the payload; a replay (or a second phone sending the same code) gets null.
 * Codes are platform-scoped so a Linq code cannot bind a Telegram identity.
 */
export const consumeLinkCode = async (
  code: LinkCode,
  platform: MessengerPlatform,
): Promise<LinkCodePayload | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.getdel(linkCodeKey(code));
  if (!raw) return null;

  let payload: LinkCodePayload;
  try {
    payload = JSON.parse(raw) as LinkCodePayload;
  } catch {
    return null;
  }
  if (payload.platform !== platform) {
    log('consumeLinkCode: platform mismatch code=%s expected=%s', payload.platform, platform);
    return null;
  }

  await redis.del(linkCodeReuseKey(payload.platform, payload.userId));
  return payload;
};

/** Record the outcome of a consumed code so the polling web page can settle. */
export const settleLinkCode = async (
  pollId: string,
  result: Exclude<LinkCodePollStatus, { status: 'pending' }>,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;

  const key = linkCodePollKey(pollId);
  const raw = await redis.get(key);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as LinkCodePollRecord;
    await redis.set(key, JSON.stringify({ ...record, result }), 'EX', CONSUMED_MARKER_TTL_SECONDS);
  } catch {
    /* corrupt record — the page falls back to `expired` */
  }
};

/**
 * Read a poll record for its owner. Returns `expired` when the record is gone,
 * belongs to someone else, or the code ran out while still pending.
 */
export const peekLinkCodeStatus = async (
  pollId: string,
  userId: string,
): Promise<LinkCodePollStatus | { status: 'expired' }> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return { status: 'expired' };

  const raw = await redis.get(linkCodePollKey(pollId));
  if (!raw) return { status: 'expired' };

  let record: LinkCodePollRecord;
  try {
    record = JSON.parse(raw) as LinkCodePollRecord;
  } catch {
    return { status: 'expired' };
  }
  if (record.userId !== userId) return { status: 'expired' };

  if (record.result.status === 'pending' && !(await redis.exists(linkCodeKey(record.code)))) {
    return { status: 'expired' };
  }
  return record.result;
};

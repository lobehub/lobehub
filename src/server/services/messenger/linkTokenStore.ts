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
  return payload;
};

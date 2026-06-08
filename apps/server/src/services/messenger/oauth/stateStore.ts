import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:messenger:oauth-state');

const STATE_TTL_SECONDS = 600; // 10 minutes — Slack OAuth flow is interactive but quick
const KEY_PREFIX = 'messenger:slack-oauth-state:';

const stateKey = (state: string): string => `${KEY_PREFIX}${state}`;

export interface OAuthStatePayload {
  /** LobeHub user who clicked "Connect Slack". Persisted on the install row. */
  lobeUserId: string;
  /** Where to send the user after the callback finishes (relative path). */
  returnTo?: string;
  /** Issuance timestamp (ms epoch) for diagnostics. */
  ts: number;
}

/**
 * Issue a single-use OAuth state token bound to the LobeHub user who
 * initiated the install. Returns the opaque `state` string the caller passes
 * to Slack's authorize URL — Slack echoes it back in the callback.
 *
 * Same Redis-backed single-use pattern as `linkTokenStore` so the security
 * properties (TTL expiry, GETDEL on consume, no replay) are familiar.
 */
export const issueOAuthState = async (payload: Omit<OAuthStatePayload, 'ts'>): Promise<string> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required for messenger Slack OAuth state storage');

  const state = randomUUID().replaceAll('-', '');
  const value: OAuthStatePayload = { ...payload, ts: Date.now() };

  await redis.set(stateKey(state), JSON.stringify(value), 'EX', STATE_TTL_SECONDS);
  log('issueOAuthState: issued state for user=%s ttl=%ds', payload.lobeUserId, STATE_TTL_SECONDS);
  return state;
};

/**
 * Atomically read + delete the state. Replay is impossible after the first
 * consume — the Redis key is gone. Returns null if the state is invalid /
 * expired / already consumed.
 */
export const consumeOAuthState = async (state: string): Promise<OAuthStatePayload | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(stateKey(state));
  if (!raw) return null;

  // Redis 7 supports GETDEL atomically; we do GET + DEL because the codebase
  // already uses this two-step pattern (linkTokenStore.consumeLinkToken) and
  // the worst-case race (two concurrent callbacks for the same state) just
  // ends up doing the work twice — `MessengerInstallationModel.upsert` is
  // idempotent.
  await redis.del(stateKey(state));

  try {
    return JSON.parse(raw) as OAuthStatePayload;
  } catch {
    return null;
  }
};

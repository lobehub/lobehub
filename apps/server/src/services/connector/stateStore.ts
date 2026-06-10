import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:connector:oauth-state');

const STATE_TTL_SECONDS = 600; // 10 minutes — interactive but quick

const KEY_PREFIX = 'connector:oauth-state:';

const stateKey = (state: string): string => `${KEY_PREFIX}${state}`;

export interface ConnectorOAuthStatePayload {
  /** Authorization server resolved at start; reused at exchange to avoid drift. */
  authorizationServerUrl: string;
  /** PKCE verifier — must round-trip to the token exchange. */
  codeVerifier: string;
  /** The connector being connected. */
  connectorId: string;
  /** LobeHub user who initiated the connect. */
  lobeUserId: string;
  /** Where to send the user after the callback finishes (relative path). */
  returnTo?: string;
  /** Issuance timestamp (ms epoch) for diagnostics. */
  ts: number;
}

/** Generate an opaque, single-use state value to embed in the authorize URL. */
export const generateConnectorOAuthState = (): string => randomUUID().replaceAll('-', '');

/**
 * Persist the connect-flow payload under an explicit `state` value. The state
 * is chosen first (so it can be embedded in the authorize URL), then the PKCE
 * verifier returned by `startAuthorization` is stored alongside it. Same
 * Redis-backed single-use pattern as the messenger Slack OAuth state store
 * (TTL expiry, delete-on-consume, no replay).
 */
export const saveConnectorOAuthState = async (
  state: string,
  payload: Omit<ConnectorOAuthStatePayload, 'ts'>,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required for connector OAuth state storage');

  const value: ConnectorOAuthStatePayload = { ...payload, ts: Date.now() };

  await redis.set(stateKey(state), JSON.stringify(value), 'EX', STATE_TTL_SECONDS);
  log(
    'saved connector OAuth state for user=%s connector=%s',
    payload.lobeUserId,
    payload.connectorId,
  );
};

/**
 * Atomically read + delete the state. Replay is impossible after the first
 * consume. Returns null if invalid / expired / already consumed.
 */
export const consumeConnectorOAuthState = async (
  state: string,
): Promise<ConnectorOAuthStatePayload | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(stateKey(state));
  if (!raw) return null;

  await redis.del(stateKey(state));

  try {
    return JSON.parse(raw) as ConnectorOAuthStatePayload;
  } catch {
    return null;
  }
};

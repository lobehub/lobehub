import { randomUUID } from 'node:crypto';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('integrations');

const OAUTH_STATE_TTL_SECONDS = 600;
export interface LinearOAuthStatePayload {
  /** LobeHub user who clicked "Connect"; the connection belongs to them. */
  lobeUserId: string;
  /** Where to send the user after the callback (relative path). */
  returnTo?: string;
  ts: number;
  /** Workspace the connection belongs to; null for a personal connection. */
  workspaceId?: string | null;
}

export const linear = {
  /**
   * Single-use OAuth state for the "Connect Linear" redirect: TTL-bound and
   * deleted on first read, so the callback cannot be replayed. `null` without
   * Redis — the flow cannot start then.
   */
  async issueOAuthState(payload: Omit<LinearOAuthStatePayload, 'ts'>) {
    const redis = await getClient();
    if (!redis) return null;

    const state = randomUUID().replaceAll('-', '');
    const value: LinearOAuthStatePayload = { ...payload, ts: Date.now() };
    await redis.set(RedisKeys.integrations.linearOAuthState(state), JSON.stringify(value), {
      ex: OAUTH_STATE_TTL_SECONDS,
    });
    return state;
  },

  async consumeOAuthState(state: string): Promise<LinearOAuthStatePayload | null> {
    const redis = await getClient();
    if (!redis) return null;

    const key = RedisKeys.integrations.linearOAuthState(state);
    const raw = await redis.get(key);
    if (!raw) return null;
    await redis.del(key);

    try {
      return JSON.parse(raw) as LinearOAuthStatePayload;
    } catch {
      return null;
    }
  },
};

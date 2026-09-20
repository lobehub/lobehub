import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:scm:oauth-state');

const STATE_TTL_SECONDS = 600;
const KEY_PREFIX = 'scm:install-state:';

const stateKey = (state: string): string => `${KEY_PREFIX}${state}`;

export interface ScmInstallStatePayload {
  /** LobeHub user who clicked "Connect"; the installation binds to them. */
  lobeUserId: string;
  /** Where to send the user after the callback (relative path). */
  returnTo?: string;
  ts: number;
  /** Workspace to bind the installation to; null for a personal connection. */
  workspaceId?: string | null;
}

/**
 * Single-use state for the install redirect, same Redis pattern as the
 * messenger OAuth flow: TTL-bound, deleted on first consume, so the callback
 * cannot be replayed to bind a second installation to the same click.
 */
export const issueScmInstallState = async (
  payload: Omit<ScmInstallStatePayload, 'ts'>,
): Promise<string> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required for SCM install state storage');

  const state = randomUUID().replaceAll('-', '');
  const value: ScmInstallStatePayload = { ...payload, ts: Date.now() };

  await redis.set(stateKey(state), JSON.stringify(value), 'EX', STATE_TTL_SECONDS);
  log('issued state for user=%s workspace=%s', payload.lobeUserId, payload.workspaceId ?? '-');
  return state;
};

export const consumeScmInstallState = async (
  state: string,
): Promise<ScmInstallStatePayload | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(stateKey(state));
  if (!raw) return null;
  await redis.del(stateKey(state));

  try {
    return JSON.parse(raw) as ScmInstallStatePayload;
  } catch {
    return null;
  }
};

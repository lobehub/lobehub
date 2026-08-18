import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { WechatPollerMode } from './config';
import { acquireKeyLock, releaseKeyLock } from './lease';

/**
 * The mode state machine's durable half (LOBE-12811).
 *
 * The env flag (`WECHAT_GATEWAY_HOST_ENABLED`) expresses the DESIRED mode and
 * is read ONLY by the resident poller host; this Redis key records the mode
 * that is ACTUALLY in effect and is what everything else follows (gateway
 * sync, connection lifecycle routing, typing) — see
 * {@link isWechatHostRuntimeActive}. Every service tick compares the two and,
 * on mismatch, performs the transition (drain the gateway side, or rebuild it
 * via sync) under the transition lock — which is what makes "flip one env var
 * on one deployment, wait a minute" a complete migration or rollback with no
 * manual steps and no double-polling window.
 *
 * The record is only advanced AFTER the transition's actions succeed, so a
 * half-finished transition is retried in full on the next tick (both drain
 * and sync are idempotent).
 */

const ACTIVE_MODE_KEY = 'wechat:poller:active-mode';
const TRANSITION_LOCK_KEY = 'wechat:poller:transition-lock';
/** Generous: a full 148-connection drain or a gateway sync fits well within it. */
const TRANSITION_LOCK_TTL_MS = 120_000;

export const getActiveMode = async (redis: Redis): Promise<WechatPollerMode> => {
  const value = await redis.get(ACTIVE_MODE_KEY);
  // Absent = pre-migration deployments — the gateway owns WeChat.
  return value === 'host' ? 'host' : 'gateway';
};

export const setActiveMode = async (redis: Redis, mode: WechatPollerMode): Promise<void> => {
  await redis.set(ACTIVE_MODE_KEY, mode);
};

export const acquireTransitionLock = (redis: Redis, holder: string): Promise<boolean> =>
  acquireKeyLock(redis, TRANSITION_LOCK_KEY, holder, TRANSITION_LOCK_TTL_MS);

export const releaseTransitionLock = (redis: Redis, holder: string): Promise<void> =>
  releaseKeyLock(redis, TRANSITION_LOCK_KEY, holder);

/** Minimal read surface — callers hold differently-typed redis clients. */
interface ActiveModeReader {
  get: (key: string) => Promise<string | null>;
}

/**
 * Whether the resident host is the ACTIVE owner of WeChat connections right
 * now. This is the single switch the rest of the system consumes: it follows
 * the recorded actual mode, which the poller only flips after a completed
 * drain, so consumers can never run ahead of the transition. The env flag is
 * deliberately NOT read here — it lives on the poller host alone.
 *
 * Fails toward `false` (an unreadable record must not sever the incumbent
 * gateway's ownership, which is the pre-migration reality).
 */
export const isWechatHostRuntimeActive = async (
  redis?: ActiveModeReader | null,
): Promise<boolean> => {
  const client =
    redis !== undefined ? redis : (getAgentRuntimeRedisClient() as ActiveModeReader | null);
  if (!client) return false;
  try {
    return (await client.get(ACTIVE_MODE_KEY)) === 'host';
  } catch {
    return false;
  }
};

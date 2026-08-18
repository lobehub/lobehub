import type Redis from 'ioredis';

import type { WechatPollerMode } from './config';
import { acquireKeyLock, releaseKeyLock } from './lease';

/**
 * The mode state machine's durable half (LOBE-12811).
 *
 * The env flag (`WECHAT_GATEWAY_HOST_ENABLED`) expresses the DESIRED mode;
 * this Redis key records the mode that is ACTUALLY in effect. Every service
 * tick compares the two and, on mismatch, performs the transition (drain the
 * gateway side, or rebuild it via sync) under the transition lock — which is
 * what makes "flip one env var, wait a minute" a complete migration or
 * rollback with no manual steps and no double-polling window.
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

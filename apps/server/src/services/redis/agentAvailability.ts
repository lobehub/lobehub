import type { ManagedDevicePhase } from '@lobechat/types';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

/** A device as one principal pool sees it. */
export interface CachedDevicePresence {
  managedPhase?: ManagedDevicePhase;
  online: boolean;
}

/** Whether one agent's quota is spent where it runs. */
export interface CachedAgentQuota {
  exhausted: boolean;
  resetsAt?: number;
}

/** Which agent, on which device, a quota verdict is about. */
export interface AgentQuotaKey {
  agentId: string;
  deviceId?: string;
}

/** Presence moves with a socket, so a remembered answer stays short. */
const DEVICE_TTL_MS = 30 * 1000;
/** Quota readings arrive with runs; a minute keeps a refill from going unnoticed for long. */
const QUOTA_TTL_MS = 60 * 1000;
/**
 * A spent agent stays spent until its reset, but an account added or re-enabled meanwhile
 * would put it back on duty, so never trust that for longer than this.
 */
const QUOTA_EXHAUSTED_MAX_TTL_MS = 10 * 60 * 1000;

const parse = <T>(raw: string | null): T | undefined => {
  if (raw === null) return;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return;
  }
};

/** Read many keys at once; a missing key, or no Redis, reads as `undefined`. */
const readMany = async <T>(keys: string[]): Promise<(T | undefined)[]> => {
  const redis = await getRedisServiceClient('agentAvailability');
  if (!redis || keys.length === 0) return keys.map(() => undefined);
  try {
    return (await redis.mget(...keys)).map((raw) => parse<T>(raw));
  } catch {
    return keys.map(() => undefined);
  }
};

/** Fire-and-forget: the caller already has its answer. */
const writeMany = async (entries: { key: string; ttlMs: number; value: unknown }[]) => {
  const redis = await getRedisServiceClient('agentAvailability');
  if (!redis || entries.length === 0) return;
  const pipeline = redis.pipeline();
  for (const { key, ttlMs, value } of entries)
    pipeline.set(key, JSON.stringify(value), { px: Math.max(1, Math.round(ttlMs)) });
  await pipeline.exec().catch(() => undefined);
};

const quotaTtlMs = (quota: CachedAgentQuota, now: number) =>
  quota.exhausted && quota.resetsAt !== undefined && quota.resetsAt > now
    ? Math.min(quota.resetsAt - now, QUOTA_EXHAUSTED_MAX_TTL_MS)
    : QUOTA_TTL_MS;

export const agentAvailability = {
  /** Remembered presence of `deviceIds` in one principal pool, `undefined` where unknown. */
  readDevices: (pool: string, deviceIds: string[]) =>
    readMany<CachedDevicePresence>(
      deviceIds.map((deviceId) => RedisKeys.agentAvailability.device(pool, deviceId)),
    ),

  rememberDevices: (pool: string, devices: Map<string, CachedDevicePresence>) =>
    writeMany(
      [...devices].map(([deviceId, value]) => ({
        key: RedisKeys.agentAvailability.device(pool, deviceId),
        ttlMs: DEVICE_TTL_MS,
        value,
      })),
    ),

  /** Remembered quota verdicts, as `userId` sees them in `pool`; `undefined` where unknown. */
  readQuotas: (userId: string, pool: string, keys: AgentQuotaKey[]) =>
    readMany<CachedAgentQuota>(
      keys.map(({ agentId, deviceId }) =>
        RedisKeys.agentAvailability.quota(userId, pool, agentId, deviceId),
      ),
    ),

  /**
   * Remember quota verdicts. A spent agent is kept until its reset (bounded), so the key
   * expiring is the quota coming back.
   */
  rememberQuotas: (
    userId: string,
    pool: string,
    entries: (AgentQuotaKey & { quota: CachedAgentQuota })[],
    now = Date.now(),
  ) =>
    writeMany(
      entries.map(({ agentId, deviceId, quota }) => ({
        key: RedisKeys.agentAvailability.quota(userId, pool, agentId, deviceId),
        ttlMs: quotaTtlMs(quota, now),
        value: quota,
      })),
    ),
};

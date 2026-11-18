import type { ManagedDevicePhase } from '@lobechat/types';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

/** A device as one principal pool sees it. */
export interface CachedDevicePresence {
  managedPhase?: ManagedDevicePhase;
  online: boolean;
}

/** One provider account's load, the part availability reads. */
export interface CachedAccountLoad {
  enabled: boolean;
  rateLimitedUntil?: number | null;
  sessionUtil?: number;
  weeklyUtil?: number;
}

/** Presence moves with a socket, so a remembered answer stays short. */
const DEVICE_TTL_MS = 30 * 1000;
/** Quota readings arrive with runs; a minute keeps a refill from going unnoticed for long. */
const ACCOUNT_TTL_MS = 60 * 1000;
/** A benched account stays benched until its reset, but never trust that for longer than this. */
const ACCOUNT_BENCHED_MAX_TTL_MS = 6 * 60 * 60 * 1000;

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

const accountTtlMs = (load: CachedAccountLoad, now: number) =>
  load.rateLimitedUntil != null && load.rateLimitedUntil > now
    ? Math.min(load.rateLimitedUntil - now, ACCOUNT_BENCHED_MAX_TTL_MS)
    : ACCOUNT_TTL_MS;

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

  /** Remembered loads of `accountIds`, `undefined` where unknown. */
  readAccounts: (accountIds: string[]) =>
    readMany<CachedAccountLoad>(
      accountIds.map((accountId) => RedisKeys.agentAvailability.account(accountId)),
    ),

  /**
   * Remember account loads. A benched account is kept until its reset, so the key expiring is
   * the quota coming back.
   */
  rememberAccounts: (loads: Map<string, CachedAccountLoad>, now = Date.now()) =>
    writeMany(
      [...loads].map(([accountId, value]) => ({
        key: RedisKeys.agentAvailability.account(accountId),
        ttlMs: accountTtlMs(value, now),
        value,
      })),
    ),
};

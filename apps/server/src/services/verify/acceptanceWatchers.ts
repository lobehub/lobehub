import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:acceptance-watchers');

export const ACCEPTANCE_WATCHER_LEASE_MS = 90_000;

const localWatchers = new Map<string, Map<string, number>>();

const watcherKey = (acceptanceId: string, roundIndex: number): string =>
  `acceptance:${acceptanceId}:round:${roundIndex}:watchers`;

const pruneLocal = (key: string, now = Date.now()): Map<string, number> => {
  const watchers = localWatchers.get(key) ?? new Map<string, number>();
  for (const [watcherId, expiresAt] of watchers) {
    if (expiresAt <= now) watchers.delete(watcherId);
  }
  if (watchers.size === 0) localWatchers.delete(key);
  else localWatchers.set(key, watchers);
  return watchers;
};

/** Register or refresh one active SSE watcher. */
export const renewAcceptanceWatcher = async (
  acceptanceId: string,
  roundIndex: number,
  watcherId: string,
  leaseMs = ACCEPTANCE_WATCHER_LEASE_MS,
): Promise<void> => {
  const key = watcherKey(acceptanceId, roundIndex);
  const expiresAt = Date.now() + leaseMs;
  const redis = getAgentRuntimeRedisClient();

  if (redis) {
    try {
      await redis
        .multi()
        .zadd(key, expiresAt, watcherId)
        .zremrangebyscore(key, 0, Date.now())
        .expire(key, Math.ceil((leaseMs * 2) / 1000))
        .exec();
      return;
    } catch (error) {
      log('failed to renew Redis watcher lease; using local fallback %O', error);
    }
  }

  const watchers = pruneLocal(key);
  watchers.set(watcherId, expiresAt);
  localWatchers.set(key, watchers);
};

/** Remove a watcher immediately when its SSE request closes. */
export const releaseAcceptanceWatcher = async (
  acceptanceId: string,
  roundIndex: number,
  watcherId: string,
): Promise<void> => {
  const key = watcherKey(acceptanceId, roundIndex);
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      await redis.zrem(key, watcherId);
    } catch (error) {
      log('failed to release Redis watcher lease %O', error);
    }
  }

  const watchers = pruneLocal(key);
  watchers.delete(watcherId);
  if (watchers.size === 0) localWatchers.delete(key);
};

/** Whether the final-submit action can rely on a managed background watcher. */
export const hasActiveAcceptanceWatcher = async (
  acceptanceId: string,
  roundIndex: number,
): Promise<boolean> => {
  const key = watcherKey(acceptanceId, roundIndex);
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const now = Date.now();
      const results = await redis.multi().zremrangebyscore(key, 0, now).zcard(key).exec();
      return Number(results?.[1]?.[1] ?? 0) > 0;
    } catch (error) {
      log('failed to inspect Redis watcher lease; using local fallback %O', error);
    }
  }

  return pruneLocal(key).size > 0;
};

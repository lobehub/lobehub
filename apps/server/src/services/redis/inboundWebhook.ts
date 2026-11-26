import { RedisKeys } from '@/server/modules/Redis';

import { claimRedisOnce, readThroughRedis } from './cache';
import { getRedisServiceClient } from './client';

const client = () => getRedisServiceClient('inboundWebhook');

const DELIVERY_WINDOW_SECONDS = 60;
const MEMBER_COUNT_TTL_MS = 5 * 60_000;

/** Wake debounce, manual check and maintenance leases shared across workers. */
export const inboundWebhook = {
  /**
   * Counts one delivery in the scope's fixed one-minute window and returns the count so far. A
   * scope is a workspace or a personal space (`deliveryScopeOf`), shared by all its webhooks of
   * every kind. The window gets its expiry before the increment, so a crash never leaves it without
   * one. Undefined without Redis: the limit is then not enforced.
   */
  async countDelivery(scope: string) {
    const redis = await client();
    if (!redis) return;
    const key = RedisKeys.inboundWebhook.deliveries(
      scope,
      Math.floor(Date.now() / (DELIVERY_WINDOW_SECONDS * 1000)),
    );
    await redis.set(key, '0', { ex: DELIVERY_WINDOW_SECONDS * 2, nx: true });
    return redis.incr(key);
  },
  /**
   * The workspace's active member count, for its delivery limit; `read` is the live count, served
   * from Redis for five minutes so a busy webhook does not count members on every call.
   */
  async workspaceMemberCount(workspaceId: string, read: () => Promise<number>) {
    return readThroughRedis(await client(), RedisKeys.inboundWebhook.members(workspaceId), read, {
      ttlMs: MEMBER_COUNT_TTL_MS,
    });
  },
  async claimWakeWindow(id: string) {
    return claimRedisOnce(await client(), RedisKeys.inboundWebhook.wake(id), 10_000);
  },
  async claimCheck(id: string) {
    return claimRedisOnce(await client(), RedisKeys.inboundWebhook.check(id), 30_000);
  },
  async claimMaintenance(id: string) {
    return claimRedisOnce(await client(), RedisKeys.inboundWebhook.maintenance(id), 60_000);
  },
  async claimSweep() {
    return claimRedisOnce(await client(), RedisKeys.inboundWebhook.sweep(), 60_000);
  },
};

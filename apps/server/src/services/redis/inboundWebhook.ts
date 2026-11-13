import { RedisKeys } from '@/server/modules/Redis';

import { claimRedisOnce } from './cache';
import { getRedisServiceClient } from './client';

const client = () => getRedisServiceClient('inboundWebhook');

/** Wake debounce, manual check and maintenance leases shared across workers. */
export const inboundWebhook = {
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

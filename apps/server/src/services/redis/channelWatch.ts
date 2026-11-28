import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentSteer');

/** Longer than any watch can last (48 reports, two hours apart). */
const STOPPED_TTL_MS = 5 * 24 * 60 * 60 * 1000;

/** Stop marks for Channel Thread watches; each scheduled report checks its watch first. */
export const channelWatch = {
  /** @returns false without Redis, when the stop could not be recorded */
  async stop(watchId: string): Promise<boolean> {
    const redis = await getClient();
    if (!redis) return false;
    await redis.set(RedisKeys.agentSteer.channelWatchStopped(watchId), '1', {
      px: STOPPED_TTL_MS,
    });
    return true;
  },

  /** A mark that cannot be read counts as not stopped: the report still checks its Threads. */
  async isStopped(watchId: string): Promise<boolean> {
    const redis = await getClient();
    if (!redis) return false;
    return !!(await redis.get(RedisKeys.agentSteer.channelWatchStopped(watchId)).catch(() => null));
  },
};

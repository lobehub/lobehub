import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentRun');

// Comfortably longer than one settle (minutes of LLM work), and shorter than
// QStash's last retry (~30 min), so a delivery that crashed mid-settle is taken
// over by that retry instead of being lost.
const LEASE_TTL_MS = 10 * 60 * 1000;
// Outlives the whole QStash retry schedule.
const SETTLED_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const SETTLING = 'settling';
const SETTLED = 'settled';

export type TaskRunDeliveryClaim = 'claimed' | 'in-progress' | 'settled' | 'unavailable';

/**
 * At-most-once settling of a run's `onComplete` delivery, per operation.
 *
 * QStash redelivers on timeout, and settling a run takes longer than the
 * delivery timeout, so one finished run can reach the Task several times.
 */
export const taskRunDelivery = {
  /**
   * @returns `claimed` when this delivery owns the settle, `in-progress` while
   * another one holds it, `settled` once it finished, `unavailable` when Redis
   * cannot arbitrate
   */
  async claim(operationId: string): Promise<TaskRunDeliveryClaim> {
    const redis = await getClient();
    if (!redis) return 'unavailable';

    const key = RedisKeys.agentRun.taskRunDelivery(operationId);
    try {
      if ((await redis.set(key, SETTLING, { nx: true, px: LEASE_TTL_MS })) === 'OK') {
        return 'claimed';
      }
      return (await redis.get(key)) === SETTLED ? 'settled' : 'in-progress';
    } catch {
      return 'unavailable';
    }
  },

  /** Best effort: without the marker a late retry waits out the lease and settles again. */
  async markSettled(operationId: string): Promise<void> {
    const redis = await getClient();
    if (!redis) return;

    await redis
      .set(RedisKeys.agentRun.taskRunDelivery(operationId), SETTLED, { px: SETTLED_TTL_MS })
      .catch(() => undefined);
  },

  /** Best effort: a claim that cannot be released lapses with its lease. */
  async release(operationId: string): Promise<void> {
    const redis = await getClient();
    if (!redis) return;

    await redis.del(RedisKeys.agentRun.taskRunDelivery(operationId)).catch(() => undefined);
  },
};

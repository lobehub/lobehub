import debug from 'debug';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const log = debug('lobe-server:redis:bot-deferred');

const getClient = () => getRedisServiceClient('botDeferred');

// As long as a parked message can wait for its replay (`deferredMessages` TTL). Each message has
// its own key, so traffic on a busy thread never keeps an old message's count alive.
const REPLAY_COUNT_TTL_SECONDS = 30 * 60;

/**
 * Replay counts for bot messages parked while their topic was busy, by origin platform id.
 *
 * The bot's deferred-message replay reads them to stop a message that keeps coming back from
 * running again, counts a delivery the SDK accepted, and gives a lap back when a replay is parked
 * again without running. Without Redis reads return `undefined` and writes are no-ops: the caller
 * then replays as it did before the budget existed.
 */
export const botDeferred = {
  /** One count per message id (0 when never replayed), or `undefined` when Redis is unavailable. */
  async replayCounts(
    applicationId: string,
    threadId: string,
    messageIds: string[],
  ): Promise<number[] | undefined> {
    if (messageIds.length === 0) return [];
    const redis = await getClient();
    if (!redis) return undefined;
    try {
      const values = await redis.mget(
        ...messageIds.map((id) => RedisKeys.botDeferred.replays(applicationId, threadId, id)),
      );
      return messageIds.map((_, index) => Number(values[index] ?? 0) || 0);
    } catch (error) {
      log('replayCounts failed for thread=%s: %O', threadId, error);
      return undefined;
    }
  },

  /** Count one replay of each message that reached the SDK. */
  async countReplays(applicationId: string, threadId: string, messageIds: string[]) {
    await adjust(applicationId, threadId, messageIds, 'incr');
  },

  /** Give back the lap of each replayed message parked again without running. */
  async refundReplays(applicationId: string, threadId: string, messageIds: string[]) {
    await adjust(applicationId, threadId, messageIds, 'decr');
  },
};

const adjust = async (
  applicationId: string,
  threadId: string,
  messageIds: string[],
  command: 'decr' | 'incr',
): Promise<void> => {
  if (messageIds.length === 0) return;
  const redis = await getClient();
  if (!redis) return;
  try {
    const pipeline = redis.pipeline();
    for (const id of messageIds) {
      const key = RedisKeys.botDeferred.replays(applicationId, threadId, id);
      pipeline[command](key);
      pipeline.expire(key, REPLAY_COUNT_TTL_SECONDS);
    }
    await pipeline.exec();
  } catch (error) {
    log('%s replays failed for thread=%s: %O', command, threadId, error);
  }
};

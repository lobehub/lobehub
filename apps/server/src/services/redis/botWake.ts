import { randomUUID } from 'node:crypto';

import debug from 'debug';
import pMap from 'p-map';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const log = debug('lobe-server:redis:bot-wake');

const getClient = () => getRedisServiceClient('botWake');

// Channel state is only a hint for the next wake decision. A day of silence in a channel makes
// every field stale, so the key expires instead of being cleaned up.
const CHANNEL_TTL_SECONDS = 24 * 60 * 60;
const SCHEDULER_TTL_SECONDS = 24 * 60 * 60;
const CLASSIFIER_CALLS_TTL_SECONDS = 2 * 60 * 60;

// A conversation contributes its own key plus its Discord thread keys, so the read fan-out stays
// small but is still bounded: an unbounded `Promise.all` would open one Redis round trip per key.
const CHANNEL_READ_CONCURRENCY = 5;

// A burst of chat messages lands within a few hundred ms, and each holder spends a few round
// trips under the lock. The retry window (~1s with jitter) is sized for that burst; a writer
// that still cannot get in reports `undefined` and the caller wakes as it did before.
const LOCK_TTL_MS = 3000;
const LOCK_ATTEMPTS = 25;
const LOCK_RETRY_MS = 30;

/** What the wake policies read about one channel or thread; epoch ms. */
export interface BotWakeChannelFields {
  botLastSpokeAt?: number;
  followupUntil?: number;
  ownerLastSpokeAt?: number;
  silentWakes: number;
}

const toNumber = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseFields = (hash: Record<string, string> | null | undefined): BotWakeChannelFields => ({
  botLastSpokeAt: toNumber(hash?.botLastSpokeAt),
  followupUntil: toNumber(hash?.followupUntil),
  ownerLastSpokeAt: toNumber(hash?.ownerLastSpokeAt),
  silentWakes: toNumber(hash?.silentWakes) ?? 0,
});

/**
 * Merges the states of the keys a conversation is filed under (channel and Discord thread).
 * Times take the latest; the silent-wake count takes the highest, the stricter reading.
 */
export const mergeBotWakeChannelFields = (
  fields: readonly BotWakeChannelFields[],
): BotWakeChannelFields => {
  const max = (pick: (field: BotWakeChannelFields) => number | undefined) => {
    const values = fields.map(pick).filter((value): value is number => value !== undefined);

    return values.length > 0 ? Math.max(...values) : undefined;
  };

  return {
    botLastSpokeAt: max((field) => field.botLastSpokeAt),
    followupUntil: max((field) => field.followupUntil),
    ownerLastSpokeAt: max((field) => field.ownerLastSpokeAt),
    silentWakes: Math.max(0, ...fields.map((field) => field.silentWakes)),
  };
};

/** KEYS = channel hashes; ARGV[1] = ttl; ARGV[2] = botLastSpokeAt; ARGV[3] = followupUntil */
const BOT_SPOKE_SCRIPT = `
for i = 1, #KEYS do
  redis.call('HSET', KEYS[i], 'botLastSpokeAt', ARGV[2], 'followupUntil', ARGV[3], 'silentWakes', '0')
  redis.call('EXPIRE', KEYS[i], ARGV[1])
end
return 1
`;

/** KEYS = channel hashes; ARGV[1] = ttl. Counts one wake that ended without the bot speaking. */
const SILENT_WAKE_SCRIPT = `
local top = 0
for i = 1, #KEYS do
  local n = redis.call('HINCRBY', KEYS[i], 'silentWakes', 1)
  redis.call('EXPIRE', KEYS[i], ARGV[1])
  if n > top then top = n end
end
return top
`;

/** Releases the lock only for the writer that took it. KEYS[1] = lock; ARGV[1] = token. */
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const botWake = {
  /**
   * Counts one classifier call against the bot's UTC hour. `undefined` without Redis, so the
   * caller decides whether to spend.
   */
  async countClassifierCall(applicationId: string, utcHour: string) {
    try {
      const redis = await getClient();
      if (!redis) return;

      const key = RedisKeys.botWake.classifierCalls(applicationId, utcHour);
      const value = await redis.incr(key);
      await redis.expire(key, CLASSIFIER_CALLS_TTL_SECONDS);

      return value;
    } catch (error) {
      log('countClassifierCall failed: %O', error);
    }
  },

  /**
   * Reads and merges the state filed under a conversation's keys. `undefined` when Redis is
   * unavailable (the caller treats the channel as having no history).
   */
  async readChannel(keys: readonly string[]): Promise<BotWakeChannelFields | undefined> {
    try {
      const redis = await getClient();
      if (!redis) return;

      const hashes = await pMap(
        keys,
        (key) => redis.hgetall(RedisKeys.botWake.channel(key)),
        { concurrency: CHANNEL_READ_CONCURRENCY },
      );

      return mergeBotWakeChannelFields(hashes.map(parseFields));
    } catch (error) {
      log('readChannel failed: %O', error);
    }
  },

  /** The owner posted: remember when, so the bot can stay out of their conversation. */
  async recordOwnerSpoke(keys: readonly string[], at: number) {
    try {
      const redis = await getClient();
      if (!redis) return;

      const pipeline = redis.pipeline();
      for (const key of keys) {
        const channelKey = RedisKeys.botWake.channel(key);
        pipeline.hset(channelKey, 'ownerLastSpokeAt', String(at));
        pipeline.expire(channelKey, CHANNEL_TTL_SECONDS);
      }
      await pipeline.exec();
    } catch (error) {
      log('recordOwnerSpoke failed: %O', error);
    }
  },

  /**
   * The bot posted a reply. Opens the follow-up window and resets the silent-wake budget, on
   * every key given (the Discord channel and its thread).
   */
  async recordBotSpoke(keys: readonly string[], at: number, windowMs: number) {
    try {
      const redis = await getClient();
      if (!redis || keys.length === 0) return;

      await redis.eval(
        BOT_SPOKE_SCRIPT,
        keys.length,
        ...keys.map((key) => RedisKeys.botWake.channel(key)),
        CHANNEL_TTL_SECONDS,
        String(at),
        String(at + windowMs),
      );
    } catch (error) {
      log('recordBotSpoke failed: %O', error);
    }
  },

  /** A follow-up wake ended without the bot speaking. Returns the highest count now stored. */
  async recordSilentWake(keys: readonly string[]) {
    try {
      const redis = await getClient();
      if (!redis || keys.length === 0) return;

      return await redis.eval<number>(
        SILENT_WAKE_SCRIPT,
        keys.length,
        ...keys.map((key) => RedisKeys.botWake.channel(key)),
        CHANNEL_TTL_SECONDS,
      );
    } catch (error) {
      log('recordSilentWake failed: %O', error);
    }
  },

  /**
   * Runs `mutate` against one channel's scheduler state under a short lock, so two messages
   * landing together cannot both open a run. The state is opaque JSON owned by the scheduler.
   *
   * Returns:
   * - `mutate`'s result, or `undefined` when Redis is unavailable or the lock could not be
   *   taken. The caller then falls back to waking immediately.
   */
  async mutateScheduler<TState, TResult>(
    key: string,
    mutate: (state: TState | undefined) => { result: TResult; state: TState },
  ): Promise<TResult | undefined> {
    let lockKey: string | undefined;
    const token = randomUUID();

    try {
      const redis = await getClient();
      if (!redis) return;

      lockKey = RedisKeys.botWake.schedulerLock(key);
      let locked = false;
      for (let attempt = 0; attempt < LOCK_ATTEMPTS && !locked; attempt++) {
        locked = (await redis.set(lockKey, token, { nx: true, px: LOCK_TTL_MS })) === 'OK';
        if (!locked) await sleep(LOCK_RETRY_MS + Math.random() * LOCK_RETRY_MS);
      }
      if (!locked) {
        lockKey = undefined;
        return;
      }

      const stateKey = RedisKeys.botWake.scheduler(key);
      const stored = await redis.get(stateKey);
      const { result, state } = mutate(stored ? (JSON.parse(stored) as TState) : undefined);
      await redis.set(stateKey, JSON.stringify(state), { ex: SCHEDULER_TTL_SECONDS });

      return result;
    } catch (error) {
      log('mutateScheduler failed: %O', error);
    } finally {
      if (lockKey) {
        try {
          const redis = await getClient();
          await redis?.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
        } catch (error) {
          log('scheduler lock release failed: %O', error);
        }
      }
    }
  },
};

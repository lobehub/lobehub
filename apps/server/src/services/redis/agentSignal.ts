import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentSignal');

// Every count returns `undefined` when Redis is unavailable: the Agent Signal callers decide
// whether that fails open or closed, since each one guards different spend.

const CLASSIFIER_CALLS_TTL_SECONDS = 2 * 24 * 60 * 60;
const DECLARATION_SLOTS_TTL_SECONDS = 24 * 60 * 60;
const MANUAL_TRIGGER_WINDOW_SECONDS = 60 * 60;
const NIGHTLY_TOPICS_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Admits candidate topic ids into the night's set while it holds fewer than `limit` members.
 * Ids already in the set are admitted without counting again, so a replayed run never
 * double-counts.
 *
 * KEYS[1] = set key; ARGV[1] = limit; ARGV[2] = ttl seconds; ARGV[3..] = topic ids
 */
const CLAIM_NIGHTLY_TOPICS_SCRIPT = `
local admitted = {}
local count = redis.call('SCARD', KEYS[1])
local limit = tonumber(ARGV[1])
for i = 3, #ARGV do
  local id = ARGV[i]
  if redis.call('SISMEMBER', KEYS[1], id) == 1 then
    table.insert(admitted, id)
  elseif count < limit then
    redis.call('SADD', KEYS[1], id)
    count = count + 1
    table.insert(admitted, id)
  end
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return admitted
`;

const count = async (key: string, ttlSeconds: number) => {
  const redis = await getClient();
  if (!redis) return;

  const value = await redis.incr(key);
  await redis.expire(key, ttlSeconds);
  return value;
};

export const agentSignal = {
  /** Counts one feedback-classifier call against the user's UTC day. */
  async countClassifierCall(scope: { userId: string; utcDay: string }) {
    return count(
      RedisKeys.agentSignal.classifierCalls(scope.userId, scope.utcDay),
      CLASSIFIER_CALLS_TTL_SECONDS,
    );
  },

  /** Takes one self-feedback declaration slot in a topic scope. */
  async takeDeclarationSlot(scopeKey: string) {
    return count(RedisKeys.agentSignal.declarationSlots(scopeKey), DECLARATION_SLOTS_TTL_SECONDS);
  },

  /** Returns a slot whose declaration was rejected or failed to enqueue. */
  async releaseDeclarationSlot(scopeKey: string) {
    const redis = await getClient();
    if (!redis) return;

    await redis.decr(RedisKeys.agentSignal.declarationSlots(scopeKey));
  },

  /**
   * Counts one manual trigger in the user's fixed hourly window. The window is created with
   * its expiry before the increment, so a crash between the two never leaves it without one.
   */
  async countManualTrigger(userId: string) {
    const redis = await getClient();
    if (!redis) return;

    const key = RedisKeys.agentSignal.manualTriggers(userId);
    await redis.set(key, '0', { ex: MANUAL_TRIGGER_WINDOW_SECONDS, nx: true });
    return redis.incr(key);
  },

  /**
   * Claims topics for one user's nightly review, atomically, up to `limit` distinct topics
   * per local night. Returns the admitted ids in input order.
   */
  async claimNightlyTopics(scope: {
    limit: number;
    localDate: string;
    topicIds: string[];
    userId: string;
  }) {
    const redis = await getClient();
    if (!redis) return;

    return redis.eval<string[]>(
      CLAIM_NIGHTLY_TOPICS_SCRIPT,
      1,
      RedisKeys.agentSignal.nightlyTopics(scope.userId, scope.localDate),
      scope.limit,
      NIGHTLY_TOPICS_TTL_SECONDS,
      ...scope.topicIds,
    );
  },
};

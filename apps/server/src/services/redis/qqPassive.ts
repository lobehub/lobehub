import type { QQPassiveSlot, QQPassiveStore } from '@lobechat/chat-adapter-qq';
import { createMemoryQQPassiveStore } from '@lobechat/chat-adapter-qq';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('qqPassive');

// The longest passive window is C2C's 60 minutes. The key outlives it so a late reservation still
// finds the window and answers "closed" rather than "never opened".
const WINDOW_TTL_SECONDS = 65 * 60;
// A deferred reply waits for the next inbound message in that conversation, which may be tomorrow.
const PENDING_TTL_SECONDS = 24 * 60 * 60;

/**
 * Takes the next reply slot of a window.
 * KEYS[1] = window hash; ARGV = now (ms), windowMs, maxReplies.
 * Returns `{eventId, msgId, seq}` or nil when the window is closed or out of replies.
 */
const RESERVE_SCRIPT = `
local at = redis.call('HGET', KEYS[1], 'at')
if not at then return nil end
if tonumber(ARGV[1]) - tonumber(at) > tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return nil
end
local seq = redis.call('HINCRBY', KEYS[1], 'seq', 1)
if seq > tonumber(ARGV[3]) then return nil end
return {
  redis.call('HGET', KEYS[1], 'eventId') or '',
  redis.call('HGET', KEYS[1], 'msgId') or '',
  tostring(seq)
}
`;

/**
 * In-process stand-in for when Redis is unavailable or switched off. It only sees what this
 * instance handled, so it is a best-effort degradation, not a second source of truth.
 */
const local = createMemoryQQPassiveStore();

const parseSlot = (raw: unknown, now: number): QQPassiveSlot | null => {
  if (!Array.isArray(raw) || raw.length < 3) return null;

  const [eventId, msgId, seq] = raw.map((value) => String(value ?? ''));
  const parsedSeq = Number(seq);
  if (!Number.isFinite(parsedSeq) || parsedSeq < 1) return null;

  return { at: now, eventId: eventId || undefined, msgId: msgId || undefined, seq: parsedSeq };
};

/**
 * QQ's passive-reply window, shared by every instance: the inbound message a bot is allowed to
 * answer, how many replies of its five are spent, and the text a closed window could not carry.
 * Kept in Redis because the inbound webhook and the agent's later completion can land on
 * different instances.
 */
export const qqPassive: QQPassiveStore = {
  async open(key, token) {
    const redis = await getClient();
    if (!redis) {
      await local.open(key, token);
      return;
    }

    try {
      const windowKey = RedisKeys.qqPassive.window(key);
      const pipeline = redis.pipeline();
      pipeline.del(windowKey);
      pipeline.hset(windowKey, {
        at: String(token.at),
        eventId: token.eventId ?? '',
        msgId: token.msgId ?? '',
        seq: '0',
      });
      pipeline.expire(windowKey, WINDOW_TTL_SECONDS);
      await pipeline.exec();
    } catch {
      // A lost window costs the reply, not the message: fall back to what this instance knows.
      await local.open(key, token);
    }
  },

  async reserve(key, limits, now = Date.now()) {
    const redis = await getClient();
    if (!redis) return local.reserve(key, limits, now);

    try {
      const raw = await redis.eval(
        RESERVE_SCRIPT,
        1,
        RedisKeys.qqPassive.window(key),
        String(now),
        String(limits.windowMs),
        String(limits.maxReplies),
      );

      return parseSlot(raw, now);
    } catch {
      return local.reserve(key, limits, now);
    }
  },

  async savePending(key, text) {
    const redis = await getClient();
    if (!redis) {
      await local.savePending(key, text);
      return;
    }

    try {
      await redis.set(RedisKeys.qqPassive.pending(key), text, { ex: PENDING_TTL_SECONDS });
    } catch {
      await local.savePending(key, text);
    }
  },

  async takePending(key) {
    const redis = await getClient();
    if (!redis) return local.takePending(key);

    try {
      const pendingKey = RedisKeys.qqPassive.pending(key);
      const [text] = await Promise.all([redis.get(pendingKey), redis.del(pendingKey)]);

      return typeof text === 'string' && text ? text : undefined;
    } catch {
      return local.takePending(key);
    }
  },
};

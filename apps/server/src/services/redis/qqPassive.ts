import type {
  QQPassiveLimits,
  QQPassiveSlot,
  QQPassiveStore,
  QQPassiveToken,
} from '@lobechat/chat-adapter-qq';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('qqPassive');

// The longest passive window is C2C's 60 minutes. The key outlives it so a late reservation still
// finds the window and answers "closed" rather than "never opened".
const WINDOW_TTL_SECONDS = 65 * 60;
// A deferred reply waits for the next inbound message in that conversation, which may be tomorrow.
const PENDING_TTL_SECONDS = 24 * 60 * 60;

/**
 * Opens a window, unless the same inbound message already has one.
 * KEYS[1] = window hash; ARGV = msgId, now (ms), eventId, ttl (s).
 *
 * QQ redelivers webhooks, and a redelivery must keep the replies already spent: restarting the
 * counter would reuse `(msg_id, msg_seq)` pairs that QQ rejects as duplicates, which the send path
 * reads as "already delivered" and drops.
 * Returns 1 when a window was written, 0 when the existing one was kept.
 */
const OPEN_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'msgId')
if current and ARGV[1] ~= '' and current == ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'at', ARGV[2], 'eventId', ARGV[3], 'msgId', ARGV[1], 'seq', '0')
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`;

/**
 * Claims a parked reply. Reading and deleting must be one step: two instances flushing the same
 * conversation would otherwise both read the text and send it twice, and a `savePending()` landing
 * between a GET and a DEL would be lost.
 * KEYS[1] = pending key. Returns the text, or nil.
 */
const PENDING_TAKE_SCRIPT = `
local text = redis.call('GET', KEYS[1])
if not text then return nil end
redis.call('DEL', KEYS[1])
return text
`;

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

interface LocalWindow {
  at: number;
  eventId?: string;
  msgId?: string;
  seq: number;
}

/**
 * In-process stand-in for when Redis is unavailable or switched off. It only sees what this
 * instance handled, so it is a best-effort degradation, not a second source of truth.
 *
 * Written out here rather than imported from the adapter package: this module sits in the Redis
 * barrel every service imports, and a runtime import of `@lobechat/chat-adapter-qq` would drag the
 * adapter (and `chat` itself) into callers that never touch QQ.
 */
const createLocalStore = (): QQPassiveStore => {
  const windows = new Map<string, LocalWindow>();
  const pending = new Map<string, string>();

  return {
    open: async (key: string, token: QQPassiveToken) => {
      windows.set(key, { at: token.at, eventId: token.eventId, msgId: token.msgId, seq: 0 });
    },

    reserve: async (key: string, limits: QQPassiveLimits, now = Date.now()) => {
      const window = windows.get(key);
      if (!window) return null;
      if (now - window.at > limits.windowMs) {
        windows.delete(key);
        return null;
      }
      if (window.seq >= limits.maxReplies) return null;

      window.seq += 1;

      return { at: window.at, eventId: window.eventId, msgId: window.msgId, seq: window.seq };
    },

    savePending: async (key: string, text: string) => {
      pending.set(key, text);
    },

    takePending: async (key: string) => {
      const text = pending.get(key);
      pending.delete(key);

      return text;
    },

    restorePending: async (key: string, text: string) => {
      if (pending.has(key)) return;
      pending.set(key, text);
    },
  };
};

const local = createLocalStore();

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
      await redis.eval(
        OPEN_SCRIPT,
        1,
        RedisKeys.qqPassive.window(key),
        token.msgId ?? '',
        String(token.at),
        token.eventId ?? '',
        String(WINDOW_TTL_SECONDS),
      );
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
      const text = await redis.eval(PENDING_TAKE_SCRIPT, 1, RedisKeys.qqPassive.pending(key));

      return typeof text === 'string' && text ? text : undefined;
    } catch {
      return local.takePending(key);
    }
  },

  async restorePending(key, text) {
    const redis = await getClient();
    if (!redis) {
      await local.restorePending(key, text);
      return;
    }

    try {
      // `nx`: a reply parked while this one was in flight is newer and must win.
      await redis.set(RedisKeys.qqPassive.pending(key), text, {
        ex: PENDING_TTL_SECONDS,
        nx: true,
      });
    } catch {
      await local.restorePending(key, text);
    }
  },
};

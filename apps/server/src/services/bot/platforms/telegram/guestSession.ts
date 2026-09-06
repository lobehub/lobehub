import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { BotReplyLocale } from '../const';

/**
 * Cross-process Guest Mode reply state. The first outbound call answers the
 * guest query; later edits (queue-mode callbacks in a fresh isolate) need the
 * `inline_message_id` that came back.
 *
 * Memory covers same-process local mode; Redis covers the webhook → callback
 * hop. TTL matches the agent execution ceiling.
 */
export interface TelegramGuestSession {
  guestQueryId: string;
  inlineMessageId?: string;
  lastText?: string;
  /**
   * Reply locale derived from the summoning user's Telegram `language_code`.
   * Persisted alongside the session so later edits (possibly in another
   * process via the callback isolate) localize Guest Mode notices the same
   * way as the first reply.
   */
  locale?: BotReplyLocale;
  /**
   * Kind of the current inline message after a successful `editMessageMedia`.
   * Telegram cannot convert a photo back into a text message, so later
   * text-only edits must use `editMessageCaption` instead of `editMessageText`.
   */
  mediaType?: 'photo';
  /**
   * Write timestamp (ms). Used to pick the newer copy when a failed Redis
   * `set` leaves Redis holding an older session than in-process memory.
   * Legacy sessions persisted before this field existed read as `0`.
   */
  savedAt?: number;
  /**
   * Whether an earlier body update exceeded Telegram's single-message limit.
   * Append updates retain the truncation notice even when the stored prefix
   * plus the new chunk would otherwise fit.
   */
  truncated?: boolean;
}

const TTL_SECONDS = 30 * 60;
const memory = new Map<string, { expiresAt: number; session: TelegramGuestSession }>();

const buildKey = (sessionScope: string, threadId: string): string =>
  `bot:telegram-guest:${sessionScope}:${threadId}`;

const pruneExpiredMemory = (now: number): void => {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
};

const readMemory = (key: string): TelegramGuestSession | undefined => {
  const now = Date.now();
  pruneExpiredMemory(now);
  const entry = memory.get(key);
  if (!entry) return undefined;
  return entry.session;
};

const writeMemory = (key: string, session: TelegramGuestSession): void => {
  const now = Date.now();
  pruneExpiredMemory(now);
  memory.set(key, { expiresAt: now + TTL_SECONDS * 1000, session });
};

const writeMemoryIfAbsent = (key: string, session: TelegramGuestSession): void => {
  if (!readMemory(key)) writeMemory(key, session);
};

export async function saveTelegramGuestSession(
  sessionScope: string,
  threadId: string,
  session: TelegramGuestSession,
): Promise<void> {
  const key = buildKey(sessionScope, threadId);
  // Stamp the write time so a later read can tell a stale Redis copy apart
  // from this newer in-memory write.
  const stamped = { ...session, savedAt: Date.now() };
  writeMemory(key, stamped);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(stamped), 'EX', TTL_SECONDS);
  } catch (error) {
    // console (not debug): a failed set means the webhook -> callback handoff
    // may lose this session and the guest reply will later fail with "no
    // session" / "no inline_message_id". Same-process delivery still works
    // off memory, so we do not fail the save itself, but the data-loss risk
    // must stay visible in production logs.
    console.error(
      `[guestSession] failed to persist Telegram guest session to Redis (thread=${threadId}); the reply may be undeliverable from another process`,
      error,
    );
  }
}

/**
 * Creates the inbound Guest Mode session without replacing reply state that
 * may already have been persisted by an earlier delivery of the same webhook.
 */
export async function initializeTelegramGuestSession(
  sessionScope: string,
  threadId: string,
  session: Pick<TelegramGuestSession, 'guestQueryId' | 'locale'>,
): Promise<void> {
  const key = buildKey(sessionScope, threadId);
  if (readMemory(key)) return;

  const stamped = { ...session, savedAt: Date.now() };
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    writeMemory(key, stamped);
    return;
  }

  try {
    const created = await redis.set(key, JSON.stringify(stamped), 'EX', TTL_SECONDS, 'NX');
    if (!created) return;

    // An outbound save can complete locally while the Redis command is in
    // flight. Keep that newer local state instead of replacing it with the
    // inbound-only initialization.
    writeMemoryIfAbsent(key, stamped);
  } catch (error) {
    // Redis being unavailable removes the cross-process guarantee, but the
    // same-process fallback must still preserve an existing outbound session.
    writeMemoryIfAbsent(key, stamped);
    console.error(
      `[guestSession] failed to initialize Telegram guest session in Redis (thread=${threadId}); using in-memory state`,
      error,
    );
  }
}

export async function getTelegramGuestSession(
  sessionScope: string,
  threadId: string,
): Promise<TelegramGuestSession | undefined> {
  const key = buildKey(sessionScope, threadId);
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const redisSession = JSON.parse(raw) as TelegramGuestSession;
        const memorySession = readMemory(key);
        // A transiently failed `set` can leave Redis holding an older copy
        // while this process already holds the newer write. Preferring Redis
        // unconditionally would write the stale copy back over memory and
        // permanently lose the newer `lastText` / `inlineMessageId`, so pick
        // the copy with the newer `savedAt` (ties and legacy unstamped
        // sessions defer to Redis, the cross-process source of truth).
        if (memorySession && (memorySession.savedAt ?? 0) > (redisSession.savedAt ?? 0)) {
          return memorySession;
        }
        writeMemory(key, redisSession);
        return redisSession;
      }
    } catch (error) {
      // Boundary: Redis is the cross-process store; same-process memory is a
      // valid cache holding the newest local write, so a transient read (or
      // corrupt value) failure degrades to the local copy instead of failing
      // the reply. Log loudly since the fallback may be stale or absent.
      console.error(
        `[guestSession] failed to read Telegram guest session from Redis (thread=${threadId}); falling back to in-memory state`,
        error,
      );
    }
  }
  return readMemory(key);
}

/** Test-only: drop in-memory sessions between cases. */
export const resetTelegramGuestSessionsForTest = (): void => {
  memory.clear();
};

/** Test-only: inspect bounded fallback state without exposing the map itself. */
export const getTelegramGuestSessionMemorySizeForTest = (): number => memory.size;

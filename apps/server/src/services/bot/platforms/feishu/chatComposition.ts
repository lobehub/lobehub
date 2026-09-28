import type { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { createBoundedMemoryCache } from './boundedMemoryCache';

const log = debug('bot-platform:feishu:chat-composition');

/**
 * Is this Feishu/Lark chat just the operator and this bot?
 *
 * The router drops the @-mention requirement for a conversation that is
 * effectively 1:1 with the bot. It used to infer that from how many distinct
 * humans had *spoken* in the thread, which is a bad proxy on Feishu: a
 * subscribed "thread" there is the whole group chat, and a silent member is
 * never counted — so a 30-person group where only one person had talked read as
 * private, and the bot answered everything that person said, including messages
 * @-ing a different bot.
 *
 * `GET /im/v1/chats/{chat_id}` reports the real composition: `user_count`
 * (群内用户的数量) and `bot_count` (群内机器人的数量). Exactly one of each means
 * the operator and this bot, and nobody else.
 *
 * Fails CLOSED: any error or missing field resolves to `false`, which means
 * "require an @-mention". Staying quiet when we cannot prove the chat is
 * private is the safe direction — the opposite mistake is the bot talking over
 * a group.
 */

/**
 * A "solo" verdict is the dangerous one to hold stale: the moment a second
 * human or bot joins, every unmentioned message would still wake the bot until
 * the entry expires. No membership event invalidates the key, so keep positive
 * verdicts short — one minute bounds how long a freshly-shared group can be
 * hijacked, while still collapsing a burst of DMs into one API call.
 */
const SOLO_TTL_SECONDS = 60;
/** A shared group going back to 1:1 is rare and harmless to notice late. */
const SHARED_TTL_SECONDS = 10 * 60;

const buildKey = (applicationId: string, chatId: string): string =>
  `bot:feishu-chat-solo:${applicationId}:${chatId}`;

/**
 * Process-local fallback for deployments without agent-runtime Redis, so the
 * verdict is still cached instead of costing one blocking Feishu request per
 * inbound message (including chatter the bot goes on to ignore). Entries
 * expire on the same TTLs as Redis.
 */
const MEMORY_CACHE_MAX_ENTRIES = 1000;
const memoryCache = createBoundedMemoryCache<boolean>(MEMORY_CACHE_MAX_ENTRIES);

/** Test hook: the memory cache is module state and would leak across cases. */
export const clearChatCompositionMemoryCache = (): void => memoryCache.clear();

/** Feishu returns the counts as strings (`"bot_count": "3"`). */
const toCount = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function isSoloBotChat(
  api: LarkApiClient,
  applicationId: string,
  chatId: string,
): Promise<boolean> {
  // Consulted on every inbound group message — cache it rather than spending
  // an API round-trip per message. Redis when available (queue-mode callbacks
  // land in other processes), process memory otherwise.
  const redis = getAgentRuntimeRedisClient();
  const key = buildKey(applicationId, chatId);
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (error) {
      log('isSoloBotChat: cache read failed: %O', error);
    }
  } else {
    const cached = memoryCache.get(key);
    if (cached !== undefined) return cached;
  }

  let solo: boolean;
  try {
    const chat = await api.getChatInfo(chatId);
    const userCount = toCount(chat?.user_count);
    const botCount = toCount(chat?.bot_count);
    solo = userCount === 1 && botCount === 1;
    log(
      'isSoloBotChat: chat=%s users=%o bots=%o solo=%s',
      chatId,
      chat?.user_count,
      chat?.bot_count,
      solo,
    );
  } catch (error) {
    // Reading chat info needs one of `im:chat` / `im:chat:read` /
    // `im:chat:readonly`. Without it every group simply stays mention-only.
    log('isSoloBotChat: getChatInfo failed, treating as a shared group: %O', error);
    return false;
  }

  const ttlSeconds = solo ? SOLO_TTL_SECONDS : SHARED_TTL_SECONDS;
  if (redis) {
    try {
      await redis.set(key, solo ? '1' : '0', 'EX', ttlSeconds);
    } catch (error) {
      log('isSoloBotChat: cache write failed: %O', error);
    }
  } else {
    memoryCache.set(key, solo, ttlSeconds);
  }
  return solo;
}

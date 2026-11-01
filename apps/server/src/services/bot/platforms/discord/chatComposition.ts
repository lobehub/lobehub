import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { createBoundedMemoryCache } from '../feishu/boundedMemoryCache';
import type { DiscordApi } from './api';

const log = debug('bot-platform:discord:chat-composition');

/**
 * A stale solo verdict is dangerous: after another human or bot joins, the bot
 * would keep treating unmentioned chatter as addressed to it. Keep it short.
 */
const SOLO_TTL_SECONDS = 60;
/** A shared thread returning to 1:1 is rare and harmless to notice late. */
const SHARED_TTL_SECONDS = 10 * 60;

const buildKey = (applicationId: string, threadId: string): string =>
  `bot:discord-thread-solo:${applicationId}:${threadId}`;

const MEMORY_CACHE_MAX_ENTRIES = 1000;
const memoryCache = createBoundedMemoryCache<boolean>(MEMORY_CACHE_MAX_ENTRIES);

/** Test hook: the memory cache is module state and would leak across cases. */
export const clearDiscordChatCompositionMemoryCache = (): void => memoryCache.clear();

/**
 * Whether a Discord thread contains exactly one human and this bot.
 *
 * `with_member=true` is essential: the bare thread-member shape only exposes
 * user ids and cannot tell humans from bots. Missing member data, an absent
 * current bot, or any REST error fails closed to mention-only behavior.
 */
export async function isSoloDiscordBotThread(
  api: Pick<DiscordApi, 'listThreadMembers'>,
  applicationId: string,
  threadId: string,
): Promise<boolean> {
  const redis = getAgentRuntimeRedisClient();
  const key = buildKey(applicationId, threadId);
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (error) {
      log('isSoloDiscordBotThread: cache read failed: %O', error);
    }
  } else {
    const cached = memoryCache.get(key);
    if (cached !== undefined) return cached;
  }

  let solo: boolean;
  try {
    const members = await api.listThreadMembers(threadId);
    const users = members.map((entry) => entry.member?.user);
    if (users.some((user) => !user)) {
      log('isSoloDiscordBotThread: thread=%s returned incomplete member data', threadId);
      return false;
    }

    const humans = users.filter((user) => user?.bot !== true);
    const bots = users.filter((user) => user?.bot === true);
    solo =
      humans.length === 1 &&
      bots.length === 1 &&
      bots[0]?.id === applicationId &&
      members.length === 2;
    log(
      'isSoloDiscordBotThread: thread=%s humans=%d bots=%d ownBot=%s solo=%s',
      threadId,
      humans.length,
      bots.length,
      bots.some((bot) => bot?.id === applicationId),
      solo,
    );
  } catch (error) {
    log('isSoloDiscordBotThread: listThreadMembers failed, treating as shared: %O', error);
    return false;
  }

  const ttlSeconds = solo ? SOLO_TTL_SECONDS : SHARED_TTL_SECONDS;
  if (redis) {
    try {
      await redis.set(key, solo ? '1' : '0', 'EX', ttlSeconds);
    } catch (error) {
      log('isSoloDiscordBotThread: cache write failed: %O', error);
    }
  } else {
    memoryCache.set(key, solo, ttlSeconds);
  }
  return solo;
}

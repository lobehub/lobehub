import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { createBoundedMemoryCache } from './boundedMemoryCache';

const log = debug('bot-platform:feishu:reaction-tracker');

/**
 * Remembers which reactions the bot placed on a message, so it can take them
 * back.
 *
 * Feishu/Lark's delete endpoint (`protocol-spec.md` §5.2) is keyed by
 * `reaction_id`, and that id is handed out exactly once — in the response to
 * the add call. Without holding onto it the bot can only ever add, so a single
 * run stacks its whole progress sequence (received → thinking → working) on the
 * user's message and never clears it.
 *
 * Normally one id is tracked per message. A list is kept because a swap can
 * add the next reaction and then fail to remove the previous one: both ids
 * must survive so a later swap or the final clear can still delete the
 * leftover instead of leaving it on the message forever.
 *
 * Redis rather than process memory because queue-mode step callbacks land in a
 * different process from the one that placed the first reaction — the same
 * reason `../../reactionState.ts` exists. Keyed by `messageId` (not thread) so
 * concurrent mentions in one chat don't clobber each other, and TTL'd to the
 * agent execution ceiling so a crashed run can't leak the key forever.
 *
 * Without agent-runtime Redis (local, single-process execution) the ids live
 * in a bounded process-local cache instead, so the step sequence still swaps
 * rather than stacking; only a cross-process callback would miss them.
 */
const TTL_SECONDS = 30 * 60;
const MEMORY_CACHE_MAX_ENTRIES = 2000;

const memoryCache = createBoundedMemoryCache<string[]>(MEMORY_CACHE_MAX_ENTRIES);

/** Test hook: the memory cache is module state and would leak across cases. */
export const clearReactionTrackerMemoryCache = (): void => memoryCache.clear();

const buildKey = (platform: string, applicationId: string, messageId: string): string =>
  `bot:feishu-reaction-id:${platform}:${applicationId}:${messageId}`;

/**
 * Accept both the JSON list written today and the bare id written by earlier
 * builds, so a rolling deploy can still clean up reactions placed before it.
 */
const parseIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    // not JSON — legacy single id
  }
  return [raw];
};

/** The `reaction_id`s the bot has placed on `messageId` and not yet removed. */
export async function readReactionIds(
  platform: string,
  applicationId: string,
  messageId: string,
): Promise<string[]> {
  const key = buildKey(platform, applicationId, messageId);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return memoryCache.get(key) ?? [];
  try {
    return parseIds(await redis.get(key));
  } catch (error) {
    log('readReactionIds failed: %O', error);
    return [];
  }
}

/** Replace the tracked set; an empty list clears the entry. */
export async function writeReactionIds(
  platform: string,
  applicationId: string,
  messageId: string,
  reactionIds: string[],
): Promise<void> {
  const ids = reactionIds.filter(Boolean);
  if (ids.length === 0) return deleteReactionIds(platform, applicationId, messageId);

  const key = buildKey(platform, applicationId, messageId);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    memoryCache.set(key, ids, TTL_SECONDS);
    return;
  }
  try {
    await redis.set(key, JSON.stringify(ids), 'EX', TTL_SECONDS);
  } catch (error) {
    log('writeReactionIds failed: %O', error);
  }
}

export async function deleteReactionIds(
  platform: string,
  applicationId: string,
  messageId: string,
): Promise<void> {
  const key = buildKey(platform, applicationId, messageId);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    memoryCache.delete(key);
    return;
  }
  try {
    await redis.del(key);
  } catch (error) {
    log('deleteReactionIds failed: %O', error);
  }
}

import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:bot:reaction-state');

/**
 * Cross-process state for the step-aware reaction feature used by the queue
 * mode. The in-memory mode tracks the same data in `AgentBridgeService`'s
 * static Map — this module exists because webhook callbacks land in a fresh
 * process and cannot reach that Map.
 *
 * Key layout: `bot:reaction:<platform>:<appId>:<userMessageId>`. Scoped by
 * `userMessageId` rather than `platformThreadId` because multiple concurrent
 * mentions in the same thread (Slack, Discord with fast users) must not clobber
 * each other's current-emoji state.
 *
 * TTL matches the agent execution ceiling (30 min) so a crashed run can't leak
 * state forever. If Redis is disabled, all operations become no-ops — the
 * caller falls back to hardcoded defaults.
 */
export interface ReactionState {
  emoji: string;
  reactionThreadId: string;
}

const TTL_SECONDS = 30 * 60;

function buildKey(platform: string, applicationId: string, userMessageId: string): string {
  return `bot:reaction:${platform}:${applicationId}:${userMessageId}`;
}

export async function saveReactionState(
  platform: string,
  applicationId: string,
  userMessageId: string,
  state: ReactionState,
): Promise<void> {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.set(
      buildKey(platform, applicationId, userMessageId),
      JSON.stringify(state),
      'EX',
      TTL_SECONDS,
    );
  } catch (error) {
    log('saveReactionState failed: %O', error);
  }
}

export async function getReactionState(
  platform: string,
  applicationId: string,
  userMessageId: string,
): Promise<ReactionState | null> {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(buildKey(platform, applicationId, userMessageId));
    if (!raw) return null;
    return JSON.parse(raw) as ReactionState;
  } catch (error) {
    log('getReactionState failed: %O', error);
    return null;
  }
}

export async function clearReactionState(
  platform: string,
  applicationId: string,
  userMessageId: string,
): Promise<void> {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(buildKey(platform, applicationId, userMessageId));
  } catch (error) {
    log('clearReactionState failed: %O', error);
  }
}

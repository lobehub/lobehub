import type { ContextReplaySnapshot } from '@lobechat/types';
import debug from 'debug';

import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const log = debug('lobe-server:redis:context-replay');
const getClient = () => getRedisServiceClient('agentRun');

// Matches the longest provider prompt-cache window; past it a replayed prefix no longer saves anything.
export const CONTEXT_REPLAY_TTL_SECONDS = 60 * 60;
const MEMORY_LIMIT = 1000;

const memory = new Map<string, { expiresAt: number; snapshot: ContextReplaySnapshot }>();

const keyOf = (userId: string, messageId: string) =>
  RedisKeys.agentRun.contextReplay(userId, messageId);

const remember = (key: string, snapshot: ContextReplaySnapshot) => {
  memory.delete(key);
  memory.set(key, { expiresAt: Date.now() + CONTEXT_REPLAY_TTL_SECONDS * 1000, snapshot });
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
};

const recall = (key: string) => {
  const entry = memory.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  remember(key, entry.snapshot);
  return entry.snapshot;
};

const parse = (value: string | null) =>
  value === null ? undefined : (JSON.parse(value) as ContextReplaySnapshot);

const commitToMemory = (key: string, committed: ContextReplaySnapshot) => {
  const existing = recall(key);
  if (existing) return existing;
  remember(key, committed);
  return committed;
};

export const contextReplay = {
  async commit(
    userId: string,
    snapshot: ContextReplaySnapshot,
    messageId = snapshot.invocationId,
  ): Promise<ContextReplaySnapshot> {
    if (snapshot.invocationId !== messageId)
      throw new Error('Context snapshot belongs to another invocation');
    const key = keyOf(userId, messageId);
    const committed = { ...snapshot, createdBy: userId };
    const redis = await getClient();
    if (!redis) return commitToMemory(key, committed);
    try {
      const value = JSON.stringify(committed);
      if ((await redis.set(key, value, { ex: CONTEXT_REPLAY_TTL_SECONDS, nx: true })) === 'OK')
        return committed;
      const existing = parse(await redis.get(key));
      if (existing) return existing;
      await redis.set(key, value, { ex: CONTEXT_REPLAY_TTL_SECONDS });
      return committed;
    } catch (error) {
      log('commit fell back to process memory: %O', error);
      return commitToMemory(key, committed);
    }
  },

  async getMany(
    userId: string,
    messageIds: string[],
  ): Promise<Record<string, ContextReplaySnapshot>> {
    const ids = [...new Set(messageIds)];
    if (!ids.length) return {};
    const keys = ids.map((id) => keyOf(userId, id));
    const redis = await getClient();
    if (redis) {
      try {
        const values = await redis.mget(...keys);
        const hits = ids.flatMap((id, index) => {
          const snapshot = parse(values[index]);
          return snapshot ? [[id, snapshot] as const] : [];
        });
        if (hits.length) {
          const renew = redis.pipeline();
          for (const [id] of hits) renew.expire(keyOf(userId, id), CONTEXT_REPLAY_TTL_SECONDS);
          await renew.exec().catch(() => undefined);
        }
        return Object.fromEntries(hits);
      } catch (error) {
        log('read fell back to process memory: %O', error);
      }
    }
    return Object.fromEntries(
      ids.flatMap((id) => {
        const snapshot = recall(keyOf(userId, id));
        return snapshot ? [[id, snapshot]] : [];
      }),
    );
  },
};

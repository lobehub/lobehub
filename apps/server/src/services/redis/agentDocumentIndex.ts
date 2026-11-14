import { getJSONFromRedis, RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('lobechat');

/**
 * The snapshot only saves cache while the provider cache is warm (minutes).
 * A day leaves room for longer provider TTLs; a lost key only costs one
 * index refresh on a turn that would usually be cold anyway.
 */
const SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;

export interface AgentDocumentIndexScope {
  agentId: string;
  threadId?: string;
  topicId: string;
}

const keyOf = ({ agentId, threadId, topicId }: AgentDocumentIndexScope) =>
  RedisKeys.lobechat.agentDocumentIndex(topicId, threadId, agentId);

export const agentDocumentIndex = {
  /**
   * The snapshot the conversation's last run rendered its agent-document index
   * from. `undefined` without Redis, after expiry, or on a read failure: the
   * caller then takes a fresh snapshot.
   */
  async get(scope: AgentDocumentIndexScope): Promise<unknown> {
    const redis = await getClient();
    if (!redis) return undefined;
    try {
      return (await getJSONFromRedis<unknown>(redis, keyOf(scope))) ?? undefined;
    } catch {
      return undefined;
    }
  },

  async set(scope: AgentDocumentIndexScope, snapshot: unknown): Promise<void> {
    const redis = await getClient();
    if (!redis) return;
    await redis
      .set(keyOf(scope), JSON.stringify(snapshot), { ex: SNAPSHOT_TTL_SECONDS })
      .catch(() => undefined);
  },
};

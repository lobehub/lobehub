import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('integrations');

/** As long as the flow's own state lives: the window asks right after the callback. */
const COMPLETION_TTL_SECONDS = 600;

export interface ConnectorOAuthCompletion {
  connectorId: string;
  linkId: string;
  lobeUserId: string;
  outcome: 'created' | 'reauthorized' | 'matchedExisting';
  workspaceId?: string;
}

export const connectorOAuth = {
  /**
   * Record how a connector OAuth flow ended, so the window that started it can
   * read the outcome when the callback's message never reaches it (the native
   * IPC only reports success; a severed `window.opener` reports nothing).
   * `false` without Redis.
   */
  async saveCompletion(flowId: string, completion: ConnectorOAuthCompletion): Promise<boolean> {
    const redis = await getClient();
    if (!redis) return false;

    await redis.set(
      RedisKeys.integrations.connectorOAuthCompletion(flowId),
      JSON.stringify(completion),
      { ex: COMPLETION_TTL_SECONDS },
    );
    return true;
  },

  /** The recorded end of a flow; `null` when none was recorded, it expired, or without Redis. */
  async readCompletion(flowId: string): Promise<ConnectorOAuthCompletion | null> {
    const redis = await getClient();
    if (!redis) return null;

    const raw = await redis.get(RedisKeys.integrations.connectorOAuthCompletion(flowId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ConnectorOAuthCompletion;
    } catch {
      return null;
    }
  },
};

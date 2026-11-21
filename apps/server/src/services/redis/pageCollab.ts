import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('lobechat');

const PROJECTION_TTL_SECONDS = 24 * 60 * 60;

export const pageCollab = {
  /**
   * A digest of the body the last projection of a page's room wrote. `null` when
   * unknown — no Redis, expired, or never projected — so the caller cannot tell
   * whether something else wrote the body since.
   */
  async lastProjectedBody(documentId: string): Promise<string | null> {
    const redis = await getClient();
    if (!redis) return null;
    try {
      return await redis.get(RedisKeys.lobechat.pageProjection(documentId));
    } catch {
      return null;
    }
  },

  async rememberProjectedBody(documentId: string, digest: string): Promise<void> {
    const redis = await getClient();
    if (!redis) return;
    await redis
      .set(RedisKeys.lobechat.pageProjection(documentId), digest, { ex: PROJECTION_TTL_SECONDS })
      .catch(() => undefined);
  },
};

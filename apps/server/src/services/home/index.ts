import debug from 'debug';

import { getRedisConfig } from '@/envs/redis';
import {
  getJSONFromRedis,
  initializeRedisWithPrefix,
  isRedisEnabled,
  RedisKeyNamespace,
  RedisKeys,
} from '@/libs/redis';

const log = debug('lobe-server:home-service');

export interface HomeBriefPair {
  hint: string;
  welcome: string;
}

export interface HomeBriefData {
  pairs: HomeBriefPair[];
}

/**
 * Home Service
 *
 * Encapsulates the read paths for surfaces on the home page that aren't
 * straight DB queries — currently the AI-generated daily brief cached in
 * Redis under `aiGeneration:home_brief:{userId}`.
 */
export class HomeService {
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Read the cached daily brief for this user. Returns `{ pairs: [] }` when
   * Redis is disabled, the key is missing, or the payload is malformed —
   * callers can render unconditionally without a null check.
   */
  async getDailyBrief(): Promise<HomeBriefData> {
    const data = await this.readDailyBriefFromRedis();
    return data ?? { pairs: [] };
  }

  private async readDailyBriefFromRedis(): Promise<HomeBriefData | null> {
    try {
      const redisConfig = getRedisConfig();
      if (!isRedisEnabled(redisConfig)) return null;

      const redis = await initializeRedisWithPrefix(redisConfig, RedisKeyNamespace.AI_GENERATION);
      const data = await getJSONFromRedis<HomeBriefData>(
        redis,
        RedisKeys.aiGeneration.homeBrief(this.userId),
      );
      if (!data || !Array.isArray(data.pairs)) return null;
      return data;
    } catch (error) {
      log('Failed to read daily brief from Redis for user %s: %O', this.userId, error);
      return null;
    }
  }
}

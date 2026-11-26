import debug from 'debug';

import { getRedisConfig } from '@/envs/redis';
import {
  getJSONFromRedis,
  initializeRedisWithPrefix,
  isRedisEnabled,
  RedisKeyNamespace,
  RedisKeys,
} from '@/server/modules/Redis';

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
  private readonly workspaceId?: string;

  constructor(userId: string, workspaceId?: string) {
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Read the cached daily brief for this user. Returns `{ pairs: [] }` when
   * Redis is disabled, the key is missing, or the payload is malformed —
   * callers can render unconditionally without a null check.
   *
   * The brief is generated from the user's personal-scope topics and tasks
   * only, so inside a workspace it would surface personal conversations (and
   * links to personal agents). Workspaces get no brief until one is generated
   * per workspace.
   */
  async getDailyBrief(): Promise<HomeBriefData> {
    if (this.workspaceId) return { pairs: [] };

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

import debug from 'debug';
import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { buildRuntimeKey, parseRuntimeKey } from '@/server/services/bot/platforms';

const log = debug('lobe-server:bot:connect-queue');

const QUEUE_KEY = 'bot:gateway:connect_queue';
export const BOT_CONNECT_QUEUE_EXPIRE_MS = 10 * 60 * 1000; // 10 minutes

interface ConnectEntry {
  timestamp: number;
  userId: string;
}

export interface BotConnectItem {
  applicationId: string;
  platform: string;
  userId: string;
}

export class BotConnectQueue {
  private get redis(): Redis | null {
    return getAgentRuntimeRedisClient();
  }

  async push(platform: string, applicationId: string, userId: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis is not available, cannot enqueue bot connect request');
    }

    const field = buildRuntimeKey(platform, applicationId);
    const value: ConnectEntry = { timestamp: Date.now(), userId };

    await this.redis.hset(QUEUE_KEY, field, JSON.stringify(value));
    log('Pushed connect request: %s (userId=%s)', field, userId);
  }

  async popAll(): Promise<BotConnectItem[]> {
    if (!this.redis) return [];

    const all = await this.redis.hgetall(QUEUE_KEY);
    if (!all || Object.keys(all).length === 0) return [];

    const now = Date.now();
    const items: BotConnectItem[] = [];
    const expiredFields: string[] = [];

    for (const [field, raw] of Object.entries(all)) {
      try {
        const entry: ConnectEntry = JSON.parse(raw);

        if (now - entry.timestamp > BOT_CONNECT_QUEUE_EXPIRE_MS) {
          expiredFields.push(field);
          continue;
        }

        const parsed = parseRuntimeKey(field);
        if (!parsed.platform || !parsed.applicationId) continue;

        items.push({
          applicationId: parsed.applicationId,
          platform: parsed.platform,
          userId: entry.userId,
        });
      } catch {
        expiredFields.push(field);
      }
    }

    if (expiredFields.length > 0) {
      await this.redis.hdel(QUEUE_KEY, ...expiredFields);
      log('Cleaned %d expired entries', expiredFields.length);
    }

    log('Popped %d connect requests (%d expired)', items.length, expiredFields.length);
    return items;
  }

  async remove(platform: string, applicationId: string): Promise<void> {
    if (!this.redis) return;

    const field = buildRuntimeKey(platform, applicationId);
    await this.redis.hdel(QUEUE_KEY, field);
    log('Removed connect request: %s', field);
  }
}

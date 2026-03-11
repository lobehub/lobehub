import debug from 'debug';
import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:bot:connect-queue');

const QUEUE_KEY = 'bot:gateway:connect_queue';
const EXPIRE_MS = 10 * 60 * 1000; // 10 minutes

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

    const field = `${platform}:${applicationId}`;
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

        if (now - entry.timestamp > EXPIRE_MS) {
          expiredFields.push(field);
          continue;
        }

        const separatorIdx = field.indexOf(':');
        if (separatorIdx === -1) continue;

        items.push({
          applicationId: field.slice(separatorIdx + 1),
          platform: field.slice(0, separatorIdx),
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

    const field = `${platform}:${applicationId}`;
    await this.redis.hdel(QUEUE_KEY, field);
    log('Removed connect request: %s', field);
  }
}

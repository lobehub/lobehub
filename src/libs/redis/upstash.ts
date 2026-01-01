import { Redis, type RedisConfigNodejs } from '@upstash/redis';
import { Buffer } from 'node:buffer';

import {
  type BaseRedisProvider,
  type RedisKey,
  type RedisMSetArgument,
  type RedisSetResult,
  type RedisValue,
  type SetOptions,
  type UpstashConfig,
} from './types';
import {
  buildUpstashSetOptions,
  normalizeMsetValues,
  normalizeRedisKey,
  normalizeRedisKeys,
} from './utils';

export class UpstashRedisProvider implements BaseRedisProvider {
  provider: 'upstash' = 'upstash';
  private client: Redis;
  private readonly prefix: string;

  constructor(options: UpstashConfig | RedisConfigNodejs) {
    const { prefix, ...clientOptions } = options as UpstashConfig & RedisConfigNodejs;
    this.prefix = prefix ? `${prefix}:` : '';
    this.client = new Redis(clientOptions as RedisConfigNodejs);
  }

  /**
   * Build a fully qualified key assuming the input was already normalized.
   * Avoids re-running normalization when callers have normalized keys (e.g. mset).
   */
  private addPrefixToKey(normalizedKey: string) {
    return `${this.prefix}${normalizedKey}`;
  }

  private buildKey(key: RedisKey) {
    return this.addPrefixToKey(normalizeRedisKey(key));
  }

  private buildKeys(keys: RedisKey[]) {
    return normalizeRedisKeys(keys).map((key) => `${this.prefix}${key}`);
  }

  async initialize(): Promise<void> {
    await this.client.ping();
  }

  async disconnect() {
    // upstash client is stateless http, nothing to disconnect
  }

  async get(key: RedisKey): Promise<string | null> {
    return this.client.get(this.buildKey(key));
  }

  async set(key: RedisKey, value: RedisValue, options?: SetOptions): Promise<RedisSetResult> {
    const res = await this.client.set(this.buildKey(key), value, buildUpstashSetOptions(options));
    if (Buffer.isBuffer(res)) {
      return res.toString();
    }

    return res;
  }

  async setex(key: RedisKey, seconds: number, value: RedisValue): Promise<'OK'> {
    return this.client.setex(this.buildKey(key), seconds, value);
  }

  async del(...keys: RedisKey[]): Promise<number> {
    return this.client.del(...this.buildKeys(keys));
  }

  async exists(...keys: RedisKey[]): Promise<number> {
    return this.client.exists(...this.buildKeys(keys));
  }

  async expire(key: RedisKey, seconds: number): Promise<number> {
    return this.client.expire(this.buildKey(key), seconds);
  }

  async ttl(key: RedisKey): Promise<number> {
    return this.client.ttl(this.buildKey(key));
  }

  async incr(key: RedisKey): Promise<number> {
    return this.client.incr(this.buildKey(key));
  }

  async decr(key: RedisKey): Promise<number> {
    return this.client.decr(this.buildKey(key));
  }

  async mget(...keys: RedisKey[]): Promise<(string | null)[]> {
    return this.client.mget(...this.buildKeys(keys));
  }

  async mset(values: RedisMSetArgument): Promise<'OK'> {
    const normalized = normalizeMsetValues(values);
    const prefixed = Object.entries(normalized).reduce<Record<string, RedisValue>>(
      (acc, [key, value]) => {
        acc[this.addPrefixToKey(key)] = value;
        return acc;
      },
      {},
    );

    return this.client.mset(prefixed);
  }

  async hget(key: RedisKey, field: RedisKey): Promise<string | null> {
    return this.client.hget(this.buildKey(key), normalizeRedisKey(field));
  }

  async hset(key: RedisKey, field: RedisKey, value: RedisValue): Promise<number> {
    return this.client.hset(this.buildKey(key), { [normalizeRedisKey(field)]: value });
  }

  async hdel(key: RedisKey, ...fields: RedisKey[]): Promise<number> {
    return this.client.hdel(this.buildKey(key), ...normalizeRedisKeys(fields));
  }

  async hgetall(key: RedisKey): Promise<Record<string, string>> {
    const res = await this.client.hgetall(this.buildKey(key));
    if (!res) {
      return {};
    }

    return res as Record<string, string>;
  }
}

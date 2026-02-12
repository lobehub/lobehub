import debug from 'debug';
import { type Redis } from 'ioredis';

import {
  type BaseRedisProvider,
  type RedisConfig,
  type RedisKey,
  type RedisMSetArgument,
  type RedisSetResult,
  type RedisValue,
  type SetOptions,
} from './types';
import { buildIORedisSetArgs, normalizeMsetValues } from './utils';

const log = debug('lobe:redis');

export class IoRedisRedisProvider implements BaseRedisProvider {
  private client: Redis | null = null;

  constructor(private config: RedisConfig) {}

  async initialize() {
    const IORedis = await import('ioredis');

    this.client = new IORedis.default(this.config.url, {
      db: this.config.database,
      keyPrefix: this.config.prefix ? `${this.config.prefix}:` : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      password: this.config.password,
      tls: this.config.tls ? {} : undefined,
      username: this.config.username,
    });

    await this.client.connect();
    await this.client.ping();

    log('Connected to Redis provider with prefix "%s"', this.config.prefix);
  }

  async disconnect() {
    await this.client?.quit();
  }

  private ensureClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client is not initialized');
    }

    return this.client;
  }

  async get(key: RedisKey): Promise<string | null> {
    return this.ensureClient().get(key);
  }

  async set(key: RedisKey, value: RedisValue, options?: SetOptions): Promise<RedisSetResult> {
    const args = buildIORedisSetArgs(options);

    // ioredis has many overloads for SET; use a cast to keep async-only usage ergonomic
    return (this.ensureClient().set as any)(key, value, ...args);
  }

  async setex(key: RedisKey, seconds: number, value: RedisValue): Promise<'OK'> {
    return this.ensureClient().setex(key, seconds, value);
  }

  async del(...keys: RedisKey[]): Promise<number> {
    return this.ensureClient().del(...keys);
  }

  async exists(...keys: RedisKey[]): Promise<number> {
    return this.ensureClient().exists(...keys);
  }

  async expire(key: RedisKey, seconds: number): Promise<number> {
    return this.ensureClient().expire(key, seconds);
  }

  async ttl(key: RedisKey): Promise<number> {
    return this.ensureClient().ttl(key);
  }

  async incr(key: RedisKey): Promise<number> {
    return this.ensureClient().incr(key);
  }

  async decr(key: RedisKey): Promise<number> {
    return this.ensureClient().decr(key);
  }

  async mget(...keys: RedisKey[]): Promise<(string | null)[]> {
    return this.ensureClient().mget(...keys);
  }

  async mset(values: RedisMSetArgument): Promise<'OK'> {
    return this.ensureClient().mset(normalizeMsetValues(values));
  }

  async hget(key: RedisKey, field: RedisKey): Promise<string | null> {
    return this.ensureClient().hget(key, field);
  }

  async hset(key: RedisKey, field: RedisKey, value: RedisValue): Promise<number> {
    return this.ensureClient().hset(key, field, value);
  }

  async hdel(key: RedisKey, ...fields: RedisKey[]): Promise<number> {
    return this.ensureClient().hdel(key, ...fields);
  }

  async hgetall(key: RedisKey): Promise<Record<string, string>> {
    return this.ensureClient().hgetall(key);
  }
}

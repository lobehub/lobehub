import debug from 'debug';

import { getRedisConfig } from '@/envs/redis';
import { initializeRedis } from '@/libs/redis';

import type {
  RuntimeConfigDomain,
  RuntimeConfigProvider,
  RuntimeConfigSelector,
  VersionedSnapshot,
} from '../types';

const log = debug('lobe:runtime-config');

interface CacheRecord<T> {
  expiresAt: number;
  snapshot: VersionedSnapshot<T> | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isVersionedSnapshotEnvelope = (value: unknown): value is VersionedSnapshot<unknown> => {
  if (!isObject(value)) return false;

  return 'data' in value && 'updatedAt' in value && 'version' in value;
};

export class RedisRuntimeConfigProvider<T> implements RuntimeConfigProvider<T> {
  private cache = new Map<string, CacheRecord<T>>();

  constructor(public domain: RuntimeConfigDomain<T>) {}

  isEnabled() {
    return getRedisConfig().enabled;
  }

  private getCacheKey(selector?: RuntimeConfigSelector) {
    if (!selector || selector.scope === 'global') {
      return 'global';
    }

    return `${selector.scope}:${selector.id}`;
  }

  private getCacheRecord(selector?: RuntimeConfigSelector) {
    const record = this.cache.get(this.getCacheKey(selector));
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      this.cache.delete(this.getCacheKey(selector));
      return null;
    }

    return record.snapshot;
  }

  private setCacheRecord(snapshot: VersionedSnapshot<T> | null, selector?: RuntimeConfigSelector) {
    this.cache.set(this.getCacheKey(selector), {
      expiresAt: Date.now() + this.domain.cacheTtlMs,
      snapshot,
    });
  }

  private resolveEnvelopeData(raw: string): VersionedSnapshot<T> | null {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('[RuntimeConfig] Failed to parse snapshot payload from Redis:', error);
      return null;
    }

    if (isVersionedSnapshotEnvelope(parsed)) {
      const result = this.domain.schema.safeParse(parsed.data);

      if (!result.success) {
        log('[RuntimeConfig] Domain %s schema validation failed', this.domain.key, result.error);
        return null;
      }

      return {
        data: result.data,
        updatedAt: String(parsed.updatedAt),
        version: Number(parsed.version) || 0,
      };
    }

    const result = this.domain.schema.safeParse(parsed);

    if (!result.success) {
      log('[RuntimeConfig] Domain %s schema validation failed', this.domain.key, result.error);
      return null;
    }

    return {
      data: result.data,
      updatedAt: new Date().toISOString(),
      version: 0,
    };
  }

  async getSnapshot(selector?: RuntimeConfigSelector): Promise<VersionedSnapshot<T> | null> {
    const cached = this.getCacheRecord(selector);
    if (cached) return cached;

    try {
      const redis = await initializeRedis(getRedisConfig());
      if (!redis) return null;

      const key = this.domain.getStorageKey(selector);
      const raw = await redis.get(key);

      if (!raw) {
        this.setCacheRecord(null, selector);
        return null;
      }

      const envelope = this.resolveEnvelopeData(raw);
      this.setCacheRecord(envelope, selector);
      return envelope;
    } catch (error) {
      console.error('[RuntimeConfig] Failed to read runtime config from Redis:', error);
      return null;
    }
  }
}

import { IoRedisRedisProvider } from './redis';
import type {BaseRedisProvider, RedisConfig} from './types';

export const isRedisDisabledByEnv = () => !!process.env.DISABLE_REDIS;

export const isRedisEnabled = (config: RedisConfig) => !isRedisDisabledByEnv() && config.enabled;

const createProvider = (config: RedisConfig, prefix?: string): BaseRedisProvider | null => {
  if (!isRedisEnabled(config)) return null;

  const actualPrefix = prefix ?? config.prefix;
  return new IoRedisRedisProvider({ ...config, prefix: actualPrefix });
};

class RedisManager {
  private static instance: BaseRedisProvider | null = null;
  // NOTICE: initPromise keeps concurrent initialize() calls sharing the same in-flight setup,
  // preventing multiple connections from being created in parallel.
  private static initPromise: Promise<BaseRedisProvider | null> | null = null;

  static async initialize(config: RedisConfig): Promise<BaseRedisProvider | null> {
    if (RedisManager.instance) return RedisManager.instance;
    if (RedisManager.initPromise) return RedisManager.initPromise;

    RedisManager.initPromise = (async () => {
      const provider = createProvider(config);

      if (!provider) {
        RedisManager.instance = null;
        return null;
      }

      await provider.initialize();
      RedisManager.instance = provider;

      return provider;
    })().catch((error) => {
      RedisManager.initPromise = null;
      throw error;
    });

    return RedisManager.initPromise;
  }

  static async reset() {
    if (RedisManager.instance) {
      await RedisManager.instance.disconnect();
    }

    RedisManager.instance = null;
    RedisManager.initPromise = null;
  }
}

export const initializeRedis = (config: RedisConfig) => RedisManager.initialize(config);
export const resetRedisClient = () => RedisManager.reset();
export { RedisManager };

/**
 * Create a Redis client with custom prefix
 *
 * Unlike initializeRedis, this creates an independent client
 * that doesn't share the singleton instance.
 *
 * @param config - Redis config
 * @param prefix - Custom prefix for all keys (e.g., 'aiGeneration')
 * @returns Redis client or null if Redis is disabled
 */
export const createRedisWithPrefix = async (
  config: RedisConfig,
  prefix: string,
): Promise<BaseRedisProvider | null> => {
  const provider = createProvider(config, prefix);
  if (!provider) return null;

  await provider.initialize();
  return provider;
};

/**
 * Manages singleton Redis clients per prefix
 */
class PrefixedRedisManager {
  private static instances = new Map<string, BaseRedisProvider>();
  private static initPromises = new Map<string, Promise<BaseRedisProvider | null>>();

  static async initialize(config: RedisConfig, prefix: string): Promise<BaseRedisProvider | null> {
    const existing = this.instances.get(prefix);
    if (existing) return existing;

    const pendingPromise = this.initPromises.get(prefix);
    if (pendingPromise) return pendingPromise;

    const initPromise = (async () => {
      const provider = createProvider(config, prefix);
      if (!provider) return null;

      await provider.initialize();
      this.instances.set(prefix, provider);
      return provider;
    })().catch((error) => {
      this.initPromises.delete(prefix);
      throw error;
    });

    this.initPromises.set(prefix, initPromise);
    return initPromise;
  }

  static async reset(prefix?: string) {
    if (prefix) {
      const instance = this.instances.get(prefix);
      if (instance) {
        await instance.disconnect();
        this.instances.delete(prefix);
        this.initPromises.delete(prefix);
      }
    } else {
      for (const instance of this.instances.values()) {
        await instance.disconnect();
      }
      this.instances.clear();
      this.initPromises.clear();
    }
  }
}

/**
 * Initialize a singleton Redis client with custom prefix
 *
 * Unlike createRedisWithPrefix, this reuses the same client for each prefix,
 * avoiding connection leaks when called frequently.
 *
 * @param config - Redis config
 * @param prefix - Custom prefix for all keys (e.g., 'aiGeneration')
 * @returns Redis client or null if Redis is disabled
 */
export const initializeRedisWithPrefix = (config: RedisConfig, prefix: string) =>
  PrefixedRedisManager.initialize(config, prefix);

export const resetPrefixedRedisClient = (prefix?: string) => PrefixedRedisManager.reset(prefix);

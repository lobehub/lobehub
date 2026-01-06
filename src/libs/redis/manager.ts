import { IoRedisRedisProvider } from './redis';
import { type BaseRedisProvider, type RedisConfig } from './types';
import { UpstashRedisProvider } from './upstash';

class RedisManager {
  private static instance: BaseRedisProvider | null = null;
  // NOTICE: initPromise keeps concurrent initialize() calls sharing the same in-flight setup,
  // preventing multiple connections from being created in parallel.
  private static initPromise: Promise<BaseRedisProvider | null> | null = null;

  static async initialize(config: RedisConfig): Promise<BaseRedisProvider | null> {
    if (RedisManager.instance) return RedisManager.instance;
    if (RedisManager.initPromise) return RedisManager.initPromise;

    RedisManager.initPromise = (async () => {
      if (!config.enabled) {
        RedisManager.instance = null;
        return null;
      }

      let provider: BaseRedisProvider;

      if (config.provider === 'redis') {
        provider = new IoRedisRedisProvider(config);
      } else if (config.provider === 'upstash') {
        provider = new UpstashRedisProvider({
          prefix: config.prefix,
          token: config.token,
          url: config.url,
        });
      } else {
        throw new Error(`Unsupported redis provider: ${String((config as any).provider)}`);
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
export const isRedisEnabled = (config: RedisConfig) => config.enabled;
export { RedisManager };

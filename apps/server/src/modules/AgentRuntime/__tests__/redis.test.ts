import { afterEach, describe, expect, it, vi } from 'vitest';

const instances: Array<{ options: Record<string, unknown>; url: string }> = [];

vi.mock('ioredis', () => ({
  default: class {
    constructor(url: string, options: Record<string, unknown>) {
      instances.push({ options, url });
    }

    on() {
      return this;
    }
  },
}));

const redisEnv: Record<string, unknown> = {};

vi.mock('@/envs/redis', () => ({ redisEnv }));
vi.mock('@/server/modules/Redis', () => ({ isRedisDisabledByEnv: () => false }));

const { createAgentRuntimeRedisClient } = await import('../redis');

describe('createAgentRuntimeRedisClient', () => {
  afterEach(() => {
    instances.length = 0;
    for (const key of Object.keys(redisEnv)) delete redisEnv[key];
  });

  // A deployment that keeps the password out of REDIS_URL (REDIS_PASSWORD etc.)
  // must authenticate the same way the shared Redis provider does; otherwise
  // every Agent Runtime command fails with NOAUTH.
  it('authenticates with the separately configured Redis credentials', () => {
    Object.assign(redisEnv, {
      REDIS_DATABASE: 2,
      REDIS_PASSWORD: 'secret',
      REDIS_TLS: true,
      REDIS_URL: 'redis://redis:6379',
      REDIS_USERNAME: 'agent',
    });

    createAgentRuntimeRedisClient();

    expect(instances).toHaveLength(1);
    expect(instances[0].url).toBe('redis://redis:6379');
    expect(instances[0].options).toMatchObject({
      db: 2,
      password: 'secret',
      tls: {},
      username: 'agent',
    });
  });

  it('does not send the env credentials to an explicitly passed URL', () => {
    Object.assign(redisEnv, { REDIS_PASSWORD: 'secret', REDIS_URL: 'redis://redis:6379' });

    createAgentRuntimeRedisClient('redis://other:6379');

    expect(instances[0].url).toBe('redis://other:6379');
    expect(instances[0].options.password).toBeUndefined();
  });
});

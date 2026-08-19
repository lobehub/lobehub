// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isWechatHostRuntimeActive } from './mode';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => null),
}));

const redisWith = (mode: string | null) => ({ get: vi.fn(async () => mode) });

describe('isWechatHostRuntimeActive', () => {
  beforeEach(() => {
    delete process.env.WECHAT_GATEWAY_HOST_FORCE_GATEWAY;
  });

  afterEach(() => {
    delete process.env.WECHAT_GATEWAY_HOST_FORCE_GATEWAY;
  });

  it('follows the recorded actual mode', async () => {
    expect(await isWechatHostRuntimeActive(redisWith('host'))).toBe(true);
    expect(await isWechatHostRuntimeActive(redisWith(null))).toBe(false);
    expect(await isWechatHostRuntimeActive(redisWith('gateway'))).toBe(false);
  });

  it('the emergency force env reports gateway even while the record says host', async () => {
    process.env.WECHAT_GATEWAY_HOST_FORCE_GATEWAY = '1';
    const redis = redisWith('host');
    expect(await isWechatHostRuntimeActive(redis)).toBe(false);
    // Short-circuits before reading the (possibly stale) record.
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('fails toward gateway when redis is missing or unreadable', async () => {
    expect(await isWechatHostRuntimeActive(null)).toBe(false);
    expect(
      await isWechatHostRuntimeActive({
        get: vi.fn(async () => {
          throw new Error('redis down');
        }),
      }),
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { heteroControl } from './heteroControl';
import { defineHeteroControlCases } from './heteroControl.cases';
import { createHeteroControlFakeRedis } from './heteroControl.fake';

const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ getRedisServiceClient }));

describe('heteroControl (in-memory)', () => {
  getRedisServiceClient.mockResolvedValue(createHeteroControlFakeRedis());
  defineHeteroControlCases(() => heteroControl);
});

describe('heteroControl without Redis', () => {
  it('refuses writes and answers reads with nothing', async () => {
    getRedisServiceClient.mockResolvedValueOnce(null);
    await expect(
      heteroControl.enqueue('op', { command: 'x', createdAt: 1, id: 'c1', params: null }, 1),
    ).rejects.toThrow('Redis is unavailable');

    getRedisServiceClient.mockResolvedValueOnce(null);
    await expect(heteroControl.report('op', 'c1', { status: 'ok' })).rejects.toThrow(
      'Redis is unavailable',
    );

    getRedisServiceClient.mockResolvedValueOnce(null);
    expect(await heteroControl.claim('op')).toBeUndefined();

    getRedisServiceClient.mockResolvedValueOnce(null);
    expect(await heteroControl.read('op', 'c1')).toBeUndefined();
  });
});

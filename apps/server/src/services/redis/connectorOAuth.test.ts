import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectorOAuth } from './connectorOAuth';

const store = new Map<string, string>();
const redis = vi.hoisted(() => ({ client: null as any }));
vi.mock('./client', () => ({ getRedisServiceClient: async () => redis.client }));

const memoryClient = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
};

const completion = {
  connectorId: 'c1',
  linkId: 'lnk_a',
  lobeUserId: 'u1',
  outcome: 'created' as const,
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redis.client = memoryClient;
});

describe('redisService.connectorOAuth', () => {
  it('records how a flow ended for ten minutes and reads it back', async () => {
    expect(await connectorOAuth.saveCompletion('flow-1', completion)).toBe(true);

    expect(memoryClient.set).toHaveBeenCalledWith(
      'connector_oauth_completion:v1:flow-1',
      expect.any(String),
      { ex: 600 },
    );
    expect(await connectorOAuth.readCompletion('flow-1')).toEqual(completion);
    expect(await connectorOAuth.readCompletion('flow-2')).toBeNull();
  });

  it('records and finds nothing without Redis', async () => {
    redis.client = null;
    expect(await connectorOAuth.saveCompletion('flow-1', completion)).toBe(false);
    expect(await connectorOAuth.readCompletion('flow-1')).toBeNull();
  });
});

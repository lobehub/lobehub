import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linear } from './linear';

const store = new Map<string, string>();
const redis = vi.hoisted(() => ({ client: null as any }));
vi.mock('./client', () => ({ getRedisServiceClient: async () => redis.client }));

const memoryClient = {
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redis.client = memoryClient;
});

describe('redisService.linear', () => {
  it('hands out an OAuth state that can be consumed once', async () => {
    const state = await linear.issueOAuthState({ lobeUserId: 'u1', workspaceId: null });

    expect(memoryClient.set).toHaveBeenCalledWith(
      `linear_oauth_state:v1:${state}`,
      expect.any(String),
      { ex: 600 },
    );
    expect(await linear.consumeOAuthState(state!)).toMatchObject({ lobeUserId: 'u1' });
    expect(await linear.consumeOAuthState(state!)).toBeNull();
  });

  it('cannot start the OAuth flow without Redis', async () => {
    redis.client = null;
    expect(await linear.issueOAuthState({ lobeUserId: 'u1' })).toBeNull();
  });
});

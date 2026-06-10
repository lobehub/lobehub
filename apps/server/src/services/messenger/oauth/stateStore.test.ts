// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeOAuthState, issueOAuthState } from './stateStore';

const fakeRedis = (): {
  client: any;
  store: Map<string, string>;
} => {
  const store = new Map<string, string>();
  return {
    client: {
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    },
    store,
  };
};

let redisRef: ReturnType<typeof fakeRedis>;

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => redisRef.client),
}));

const { getAgentRuntimeRedisClient } = await import('@/server/modules/AgentRuntime/redis');

beforeEach(() => {
  redisRef = fakeRedis();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('issueOAuthState', () => {
  it('issues a hex-only state token with TTL and stores the payload as JSON', async () => {
    const before = Date.now();
    const state = await issueOAuthState({ lobeUserId: 'lobe-1', returnTo: '/settings' });
    const after = Date.now();

    expect(state).toMatch(/^[\da-f]+$/i);
    // randomUUID is 32 hex chars after stripping dashes.
    expect(state.length).toBe(32);

    const setCall = redisRef.client.set.mock.calls[0];
    expect(setCall[0]).toBe(`messenger:slack-oauth-state:${state}`);
    expect(setCall[2]).toBe('EX');
    expect(setCall[3]).toBe(600);

    const stored = JSON.parse(setCall[1]);
    expect(stored.lobeUserId).toBe('lobe-1');
    expect(stored.returnTo).toBe('/settings');
    expect(stored.ts).toBeGreaterThanOrEqual(before);
    expect(stored.ts).toBeLessThanOrEqual(after);
  });

  it('throws when redis is unavailable', async () => {
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValueOnce(null as any);
    await expect(issueOAuthState({ lobeUserId: 'lobe-1' })).rejects.toThrow('Redis is required');
  });
});

describe('consumeOAuthState', () => {
  it('round-trips the payload and atomically deletes the key', async () => {
    const state = await issueOAuthState({ lobeUserId: 'lobe-1', returnTo: '/x' });
    const payload = await consumeOAuthState(state);
    expect(payload).toMatchObject({ lobeUserId: 'lobe-1', returnTo: '/x' });
    // Replay must fail.
    expect(await consumeOAuthState(state)).toBeNull();
  });

  it('returns null for an unknown state', async () => {
    expect(await consumeOAuthState('does-not-exist')).toBeNull();
  });

  it('returns null when redis is unavailable', async () => {
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValueOnce(null as any);
    expect(await consumeOAuthState('any')).toBeNull();
  });

  it('deletes the key and returns null when stored payload is corrupt JSON', async () => {
    const state = 'corrupt-state';
    redisRef.store.set(`messenger:slack-oauth-state:${state}`, '{not-json');
    expect(await consumeOAuthState(state)).toBeNull();
    expect(redisRef.store.has(`messenger:slack-oauth-state:${state}`)).toBe(false);
  });
});

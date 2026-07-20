import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingSourceStore } from './sourceStore';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(),
}));

const transaction = {
  exec: vi.fn(),
  expire: vi.fn(),
  hset: vi.fn(),
};
const redis = { del: vi.fn(), hget: vi.fn(), hgetall: vi.fn(), multi: vi.fn() };
const store = new UnderstandingSourceStore(redis as unknown as Redis);
const reference = { sessionId: 'session-1', userId: 'user-1' };
const github = {
  context: '# GitHub',
  diagnostics: { errors: [], evidenceCount: 2, failedCount: 0, succeededCount: 2 },
  providerId: 'github',
  revision: 1,
  sourceCount: 2,
};

describe('UnderstandingSourceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
    transaction.expire.mockReturnValue(transaction);
    transaction.hset.mockReturnValue(transaction);
    redis.multi.mockReturnValue(transaction);
  });

  it('stores one provider field under hashed user/session keys for exactly three days', async () => {
    await store.put({ ...reference, ...github });

    expect(transaction.hset).toHaveBeenCalledWith(
      expect.stringMatching(
        /^onboarding_understanding:context:\{[a-f\d]{64}\}:session:[a-f\d]{64}$/,
      ),
      'github',
      JSON.stringify(github),
    );
    expect(transaction.expire).toHaveBeenCalledWith(expect.any(String), 3 * 24 * 60 * 60);
  });

  it('replaces a provider by writing the same hash field', async () => {
    await store.put({ ...reference, ...github });
    await store.put({ ...reference, ...github, context: '# Updated', revision: 2 });

    expect(transaction.hset.mock.calls[0][1]).toBe('github');
    expect(transaction.hset.mock.calls[1][1]).toBe('github');
  });

  it('reads a provider only when its provider and revision match', async () => {
    redis.hget.mockResolvedValueOnce(JSON.stringify(github));
    await expect(store.get({ ...reference, providerId: 'github', revision: 1 })).resolves.toEqual(
      github,
    );

    redis.hget.mockResolvedValueOnce(JSON.stringify({ ...github, revision: 2 }));
    await expect(store.get({ ...reference, providerId: 'github', revision: 1 })).rejects.toThrow(
      'Failed to read onboarding Understanding provider context',
    );

    redis.hget.mockResolvedValueOnce(JSON.stringify({ ...github, providerId: 'gmail' }));
    await expect(store.get({ ...reference, providerId: 'github', revision: 1 })).rejects.toThrow(
      'Failed to read onboarding Understanding provider context',
    );
  });

  it('lists validated provider contexts in stable provider order', async () => {
    const gmail = { ...github, context: '```xml\n<messages />\n```', providerId: 'gmail' };
    redis.hgetall.mockResolvedValueOnce({
      gmail: JSON.stringify(gmail),
      github: JSON.stringify(github),
    });

    await expect(store.list(reference)).resolves.toEqual([github, gmail]);
  });

  it('rejects malformed or field-mismatched stored JSON without exposing its contents', async () => {
    redis.hgetall.mockResolvedValueOnce({ github: '{"context":"PRIVATE_SOURCE"}' });
    const malformed = await store.list(reference).catch((error) => error);
    expect(malformed).toEqual(
      new Error('Failed to read onboarding Understanding provider contexts'),
    );
    expect(String(malformed)).not.toContain('PRIVATE_SOURCE');

    redis.hgetall.mockResolvedValueOnce({
      github: JSON.stringify({ ...github, providerId: 'gmail' }),
    });
    await expect(store.list(reference)).rejects.toThrow(
      'Failed to read onboarding Understanding provider contexts',
    );
  });

  it('deletes the whole hashed session key', async () => {
    await store.deleteSession(reference);

    expect(redis.del).toHaveBeenCalledWith(
      expect.stringMatching(
        /^onboarding_understanding:context:\{[a-f\d]{64}\}:session:[a-f\d]{64}$/,
      ),
    );
  });
});

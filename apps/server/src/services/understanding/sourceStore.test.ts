import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingSourceStore } from './sourceStore';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(),
}));

const redis = { del: vi.fn(), eval: vi.fn(), hget: vi.fn(), hgetall: vi.fn() };
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
    redis.eval.mockResolvedValue(1);
  });

  it('stores one provider field under hashed user/session keys for exactly three days', async () => {
    await store.put({ ...reference, ...github });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('HSET', key, field, payload)"),
      1,
      expect.stringMatching(
        /^onboarding_understanding:context:\{[a-f\d]{64}\}:session:[a-f\d]{64}$/,
      ),
      'github',
      '1',
      JSON.stringify(github),
      String(3 * 24 * 60 * 60),
    );
  });

  it('keeps newer revisions when an older collection completes later', async () => {
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const revision2 = { ...reference, ...github, context: '# Updated', revision: 2 };

    await expect(store.put(revision2)).resolves.toBe(true);
    await expect(store.put({ ...reference, ...github })).resolves.toBe(false);

    expect(redis.eval.mock.calls[0].slice(2)).toEqual([
      expect.any(String),
      'github',
      '2',
      JSON.stringify({
        context: revision2.context,
        diagnostics: revision2.diagnostics,
        providerId: revision2.providerId,
        revision: revision2.revision,
        sourceCount: revision2.sourceCount,
      }),
      String(3 * 24 * 60 * 60),
    ]);
    expect(redis.eval.mock.calls[1][4]).toBe('1');
    expect(redis.eval.mock.calls[1][0]).toContain('currentRevision >= revision');
  });

  it('uses first-write-wins for equal revisions', async () => {
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(store.put({ ...reference, ...github })).resolves.toBe(true);
    await expect(
      store.put({ ...reference, ...github, context: '# Duplicate revision' }),
    ).resolves.toBe(false);

    expect(redis.eval.mock.calls[1][4]).toBe('1');
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

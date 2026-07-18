import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingSourceStore } from './sourceStore';

const redis = { eval: vi.fn(), hdel: vi.fn(), hget: vi.fn() };
const store = new UnderstandingSourceStore(redis as unknown as Redis);
const reference = { runId: 'run-1', sessionId: 'session-1', userId: 'user-1' };

describe('UnderstandingSourceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.eval.mockResolvedValue(1);
  });

  it('stores payloads and locators in explicit fields with a 24 hour TTL', async () => {
    await store.put({
      ...reference,
      brief: 'collected markdown',
      diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
    });
    await store.putSourceLocator({
      ...reference,
      locator: {
        candidateId: 'candidate-1',
        credentialOrigin: 'connector',
        credentialReference: 'connector-1',
        provider: 'github',
      },
    });

    expect(redis.eval).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("redis.call('EXISTS'"),
      2,
      expect.any(String),
      expect.stringMatching(/:reset:[a-f\d]{64}$/),
      expect.stringMatching(/^source:[a-f\d]{64}:payload$/),
      expect.any(String),
      '86400',
    );
    expect(redis.eval).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("redis.call('EXISTS'"),
      2,
      expect.any(String),
      expect.stringMatching(/:reset:[a-f\d]{64}$/),
      expect.stringMatching(/^source:[a-f\d]{64}:locator$/),
      expect.any(String),
      '86400',
    );
  });

  it('uses a dedicated session errors field', async () => {
    await store.putSessionErrors({ errors: [], sessionId: 'session-1', userId: 'user-1' });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXISTS'"),
      2,
      expect.any(String),
      expect.stringMatching(/:reset:[a-f\d]{64}$/),
      'session:errors',
      JSON.stringify({ errors: [] }),
      '86400',
    );
  });

  it('deletes only the payload so the retry locator survives', async () => {
    await store.deleteSourcePayload(reference);

    expect(redis.hdel).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^source:[a-f\d]{64}:payload$/),
    );
  });

  it('deletes only a prepared locator when a retry claim loses', async () => {
    await store.deleteSourceLocator(reference);

    expect(redis.hdel).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^source:[a-f\d]{64}:locator$/),
    );
  });

  it('deletes the dedicated hashed session key', async () => {
    await store.deleteSession({ sessionId: reference.sessionId, userId: reference.userId });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET'"),
      2,
      expect.stringMatching(
        /^onboarding_understanding:source:\{[a-f\d]{64}\}:session:[a-f\d]{64}$/,
      ),
      expect.stringMatching(/:reset:[a-f\d]{64}$/),
      '86400',
    );
  });

  it('submits writer-before-reset commands in an order the atomic scripts can serialize', async () => {
    let releaseWrite!: (result: number) => void;
    redis.eval
      .mockImplementationOnce(() => new Promise((resolve) => (releaseWrite = resolve)))
      .mockResolvedValueOnce(1);

    const write = store.putSessionErrors({ errors: [], sessionId: 'session-1', userId: 'user-1' });
    await vi.waitFor(() => expect(redis.eval).toHaveBeenCalledTimes(1));
    const reset = store.deleteSession({ sessionId: 'session-1', userId: 'user-1' });
    releaseWrite(1);
    await Promise.all([write, reset]);

    expect(redis.eval.mock.invocationCallOrder[0]).toBeLessThan(
      redis.eval.mock.invocationCallOrder[1],
    );
  });

  it('rejects a writer submitted after reset without exposing Redis details', async () => {
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await store.deleteSession({ sessionId: 'session-1', userId: 'user-1' });

    await expect(
      store.putSessionErrors({ errors: [], sessionId: 'session-1', userId: 'user-1' }),
    ).rejects.toThrow('Failed to persist onboarding Understanding source data');
  });

  it('sanitizes Redis eval failures', async () => {
    redis.eval.mockRejectedValueOnce(new Error('RAW_REDIS_SECRET'));

    const error = await store
      .putSessionErrors({ errors: [], sessionId: 'session-1', userId: 'user-1' })
      .catch((caught) => caught);

    expect(error).toEqual(new Error('Failed to persist onboarding Understanding source data'));
    expect(String(error)).not.toContain('RAW_REDIS_SECRET');
  });
});

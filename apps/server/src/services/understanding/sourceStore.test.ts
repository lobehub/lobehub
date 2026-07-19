import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingSourceStore } from './sourceStore';

const pipeline = {
  exec: vi.fn(),
  expire: vi.fn(),
  hset: vi.fn(),
};
const redis = { del: vi.fn(), hdel: vi.fn(), hget: vi.fn(), pipeline: vi.fn() };
const store = new UnderstandingSourceStore(redis as unknown as Redis);
const reference = { sessionId: 'session-1', sourceId: 'github:account-1', userId: 'user-1' };

describe('UnderstandingSourceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipeline.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
    pipeline.expire.mockReturnValue(pipeline);
    pipeline.hset.mockReturnValue(pipeline);
    redis.pipeline.mockReturnValue(pipeline);
  });

  it('stores payloads and locators with hashed identifiers and a 24 hour TTL', async () => {
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

    expect(pipeline.hset).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /^onboarding_understanding:source:\{[a-f\d]{64}\}:session:[a-f\d]{64}$/,
      ),
      expect.stringMatching(/^source:[a-f\d]{64}:payload$/),
      expect.any(String),
    );
    expect(pipeline.hset).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.stringMatching(/^source:[a-f\d]{64}:locator$/),
      expect.not.stringContaining('secret'),
    );
    expect(pipeline.expire).toHaveBeenCalledTimes(2);
    expect(pipeline.expire).toHaveBeenCalledWith(expect.any(String), 86_400);
  });

  it('stores discovery errors in an explicit session field', async () => {
    await store.putSessionErrors({ errors: [], sessionId: 'session-1', userId: 'user-1' });

    expect(pipeline.hset).toHaveBeenCalledWith(
      expect.any(String),
      'errors',
      JSON.stringify({ errors: [] }),
    );
  });

  it('deletes only the payload so the retry locator survives', async () => {
    await store.deleteSourcePayload(reference);

    expect(redis.hdel).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^source:[a-f\d]{64}:payload$/),
    );
  });

  it('deletes an individual locator when explicitly requested', async () => {
    await store.deleteSourceLocator(reference);

    expect(redis.hdel).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^source:[a-f\d]{64}:locator$/),
    );
  });

  it('deletes the whole hashed session key without a reset tombstone', async () => {
    await store.deleteSession({ sessionId: reference.sessionId, userId: reference.userId });

    expect(redis.del).toHaveBeenCalledWith(
      expect.stringMatching(
        /^onboarding_understanding:source:\{[a-f\d]{64}\}:session:[a-f\d]{64}$/,
      ),
    );
    expect(redis).not.toHaveProperty('eval');
  });

  it('parses stored payloads and rejects invalid data without exposing it', async () => {
    redis.hget.mockResolvedValueOnce(
      JSON.stringify({
        brief: 'collected markdown',
        diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
      }),
    );
    await expect(store.get(reference)).resolves.toMatchObject({ brief: 'collected markdown' });

    redis.hget.mockResolvedValueOnce('{"brief":"RAW_PRIVATE_DATA"}');
    const error = await store.get(reference).catch((caught) => caught);
    expect(error).toEqual(new Error('Failed to read onboarding Understanding source data'));
    expect(String(error)).not.toContain('RAW_PRIVATE_DATA');
  });

  it('sanitizes Redis write failures', async () => {
    pipeline.exec.mockRejectedValueOnce(new Error('RAW_REDIS_SECRET'));

    const error = await store
      .putSessionErrors({ errors: [], sessionId: 'session-1', userId: 'user-1' })
      .catch((caught) => caught);

    expect(error).toEqual(new Error('Failed to persist onboarding Understanding source data'));
    expect(String(error)).not.toContain('RAW_REDIS_SECRET');
  });
});

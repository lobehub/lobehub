import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingSourceStore } from './sourceStore';

const transaction = {
  exec: vi.fn(),
  expire: vi.fn(),
  hset: vi.fn(),
};
const redis = { del: vi.fn(), hdel: vi.fn(), hget: vi.fn(), multi: vi.fn() };
const store = new UnderstandingSourceStore(redis as unknown as Redis);
const reference = { sessionId: 'session-1', sourceId: 'github:account-1', userId: 'user-1' };
const runReference = { ...reference, threadId: 'thread-1' };

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

  it('stores payloads and locators with hashed identifiers and a 24 hour TTL', async () => {
    await store.put({
      ...runReference,
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

    expect(transaction.hset).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /^onboarding_understanding:source:\{[a-f\d]{64}\}:session:[a-f\d]{64}$/,
      ),
      expect.stringMatching(/^source:[a-f\d]{64}:run:[a-f\d]{64}:payload$/),
      expect.any(String),
    );
    expect(transaction.hset).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.stringMatching(/^source:[a-f\d]{64}:locator$/),
      expect.not.stringContaining('secret'),
    );
    expect(transaction.expire).toHaveBeenCalledTimes(2);
    expect(transaction.expire).toHaveBeenCalledWith(expect.any(String), 86_400);
  });

  it('deletes only the payload so the retry locator survives', async () => {
    await store.deleteSourcePayload(runReference);

    expect(redis.hdel).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^source:[a-f\d]{64}:run:[a-f\d]{64}:payload$/),
    );
  });

  it('scopes raw payloads by thread while keeping locators stable by source', async () => {
    await store.put({
      ...runReference,
      brief: 'first run',
      diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
    });
    await store.put({
      ...runReference,
      brief: 'retry run',
      threadId: 'thread-2',
      diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
    });

    expect(transaction.hset.mock.calls[0][1]).not.toBe(transaction.hset.mock.calls[1][1]);
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
    await expect(store.get(runReference)).resolves.toMatchObject({ brief: 'collected markdown' });

    redis.hget.mockResolvedValueOnce('{"brief":"RAW_PRIVATE_DATA"}');
    const error = await store.get(runReference).catch((caught) => caught);
    expect(error).toEqual(new Error('Failed to read onboarding Understanding source data'));
    expect(String(error)).not.toContain('RAW_PRIVATE_DATA');
  });

  it('rejects a transaction whose expiry command fails', async () => {
    transaction.exec.mockResolvedValueOnce([
      [null, 1],
      [new Error('RAW_REDIS_SECRET'), 0],
    ]);

    const error = await store
      .put({
        ...runReference,
        brief: 'collected markdown',
        diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
      })
      .catch((caught) => caught);

    expect(error).toEqual(new Error('Failed to persist onboarding Understanding source data'));
    expect(String(error)).not.toContain('RAW_REDIS_SECRET');
  });

  it('sanitizes rejected Redis transactions', async () => {
    transaction.exec.mockRejectedValueOnce(new Error('RAW_REDIS_SECRET'));

    const error = await store
      .putSourceLocator({
        ...reference,
        locator: {
          candidateId: 'candidate-1',
          credentialOrigin: 'connector',
          credentialReference: 'connector-1',
          provider: 'github',
        },
      })
      .catch((caught) => caught);

    expect(error).toEqual(new Error('Failed to persist onboarding Understanding source data'));
    expect(String(error)).not.toContain('RAW_REDIS_SECRET');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertWorkflowRunAllowed,
  clearWorkflowRunGuard,
  listWorkflowRunGuards,
  setWorkflowRunGuard,
} from '../store';

const redis = {
  del: vi.fn(),
  get: vi.fn(),
  scan: vi.fn(),
  set: vi.fn(),
  ttl: vi.fn(),
};

describe('workflow run guard store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets a guard key with a bounded ttl and createdAt', async () => {
    redis.set.mockResolvedValue('OK');

    await setWorkflowRunGuard(redis as unknown as Parameters<typeof setWorkflowRunGuard>[0], {
      scope: { type: 'path', workflowPath: 'api/workflows/memory-user-memory' },
      ttlSeconds: 99_999,
      value: { reason: 'stop memory', policy: { cancelQstash: true } },
    });

    const [key, raw, options] = redis.set.mock.calls[0];
    expect(key).toBe('workflow:run-guard:path:api/workflows/memory-user-memory');
    expect(JSON.parse(raw)).toMatchObject({
      policy: { cancelQstash: true },
      reason: 'stop memory',
    });
    expect(JSON.parse(raw).createdAt).toEqual(expect.any(String));
    expect(options).toEqual({ ex: 86_400 });
  });

  it('sets a guard key with a finite integer ttl', async () => {
    redis.set.mockResolvedValue('OK');

    await setWorkflowRunGuard(redis as unknown as Parameters<typeof setWorkflowRunGuard>[0], {
      scope: { type: 'global' },
      ttlSeconds: 3.9,
      value: { reason: 'fractional ttl' },
    });

    expect(redis.set).toHaveBeenCalledWith('workflow:run-guard:global', expect.any(String), {
      ex: 3,
    });

    await setWorkflowRunGuard(redis as unknown as Parameters<typeof setWorkflowRunGuard>[0], {
      scope: { type: 'global' },
      ttlSeconds: Number.NaN,
      value: { reason: 'nan ttl' },
    });

    expect(redis.set).toHaveBeenLastCalledWith('workflow:run-guard:global', expect.any(String), {
      ex: 3600,
    });
  });

  it('throws WorkflowRunGuardError on the first matching key', async () => {
    redis.get.mockImplementation(async (key: string) =>
      key === 'workflow:run-guard:path:api/workflows/memory-user-memory'
        ? JSON.stringify({ reason: 'blocked' })
        : null,
    );

    await expect(
      assertWorkflowRunAllowed(redis as unknown as Parameters<typeof assertWorkflowRunAllowed>[0], {
        workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
      }),
    ).rejects.toMatchObject({
      matchedKey: 'workflow:run-guard:path:api/workflows/memory-user-memory',
      name: 'WorkflowRunGuardError',
      reason: 'blocked',
    });
  });

  it('ignores malformed guard values during execution checks', async () => {
    redis.get.mockResolvedValue('{broken');

    await expect(
      assertWorkflowRunAllowed(redis as unknown as Parameters<typeof assertWorkflowRunAllowed>[0], {
        workflowPath: 'api/workflows/memory-user-memory',
      }),
    ).resolves.toBeUndefined();
  });

  it('ignores array guard values during execution checks', async () => {
    redis.get.mockResolvedValue('[]');

    await expect(
      assertWorkflowRunAllowed(redis as unknown as Parameters<typeof assertWorkflowRunAllowed>[0], {
        workflowPath: 'api/workflows/memory-user-memory',
      }),
    ).resolves.toBeUndefined();
  });

  it('fails open when Redis get throws during execution checks', async () => {
    redis.get.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      assertWorkflowRunAllowed(redis as unknown as Parameters<typeof assertWorkflowRunAllowed>[0], {
        workflowPath: 'api/workflows/memory-user-memory',
      }),
    ).resolves.toBeUndefined();
  });

  it('clears a guard key', async () => {
    redis.del.mockResolvedValue(1);

    await expect(
      clearWorkflowRunGuard(redis as unknown as Parameters<typeof clearWorkflowRunGuard>[0], {
        type: 'user',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ deleted: 1, key: 'workflow:run-guard:user:user-1' });
  });

  it('lists guard keys using scan and ttl', async () => {
    redis.scan
      .mockResolvedValueOnce([
        '12',
        ['workflow:run-guard:global', 'workflow:run-guard:user:user-1'],
      ])
      .mockResolvedValueOnce(['0', ['workflow:run-guard:run:wfr_1']]);
    redis.get.mockImplementation(async (key: string) => JSON.stringify({ reason: key }));
    redis.ttl.mockResolvedValue(3600);

    await expect(
      listWorkflowRunGuards(redis as unknown as Parameters<typeof listWorkflowRunGuards>[0]),
    ).resolves.toEqual([
      {
        key: 'workflow:run-guard:global',
        ttlSeconds: 3600,
        value: { reason: 'workflow:run-guard:global' },
      },
      {
        key: 'workflow:run-guard:user:user-1',
        ttlSeconds: 3600,
        value: { reason: 'workflow:run-guard:user:user-1' },
      },
      {
        key: 'workflow:run-guard:run:wfr_1',
        ttlSeconds: 3600,
        value: { reason: 'workflow:run-guard:run:wfr_1' },
      },
    ]);
    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'workflow:run-guard:*', 'COUNT', 100);
    expect(redis.scan).toHaveBeenCalledWith('12', 'MATCH', 'workflow:run-guard:*', 'COUNT', 100);
    expect(redis.get).toHaveBeenCalledTimes(3);
    expect(redis.get).toHaveBeenNthCalledWith(1, 'workflow:run-guard:global');
    expect(redis.get).toHaveBeenNthCalledWith(2, 'workflow:run-guard:user:user-1');
    expect(redis.get).toHaveBeenNthCalledWith(3, 'workflow:run-guard:run:wfr_1');
    expect(redis.ttl).toHaveBeenCalledTimes(3);
    expect(redis.ttl).toHaveBeenNthCalledWith(1, 'workflow:run-guard:global');
    expect(redis.ttl).toHaveBeenNthCalledWith(2, 'workflow:run-guard:user:user-1');
    expect(redis.ttl).toHaveBeenNthCalledWith(3, 'workflow:run-guard:run:wfr_1');
  });
});

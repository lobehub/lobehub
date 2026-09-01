import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FtsSearchSyncDrainResult } from '../../apps/server/src/services/ftsSearchSync';
import { runElasticsearchFtsSearchSync, runElasticsearchFtsSearchSyncCli } from './index';

const drainResult = (
  overrides: Partial<FtsSearchSyncDrainResult> = {},
): FtsSearchSyncDrainResult => ({
  acknowledged: 1,
  bulkBytes: 100,
  bulkItems: 1,
  bulkRequests: 1,
  bulkRequestSamples: [],
  claimed: 1,
  dead: 0,
  failed: 0,
  hasMore: false,
  released: 0,
  ...overrides,
});

const createRuntime = (results: FtsSearchSyncDrainResult[]) => {
  const drainOnce = vi.fn();
  for (const result of results) drainOnce.mockResolvedValueOnce(result);
  const runtime = {
    getFtsSearchSyncService: () => ({
      drainOnce,
      hasDeadLetters: vi.fn().mockResolvedValue(false),
    }),
    verifyFtsSearchSyncReadiness: vi.fn().mockResolvedValue(undefined),
  };
  return { drainOnce, runtime };
};

describe('runElasticsearchFtsSearchSync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drains until the queue is empty within the configured bound', async () => {
    const { drainOnce, runtime } = createRuntime([
      drainResult({ hasMore: true }),
      drainResult({ acknowledged: 2, bulkItems: 2, claimed: 2 }),
    ]);

    await expect(
      runElasticsearchFtsSearchSync({ loadRuntime: async () => runtime, maxSteps: 8 }),
    ).resolves.toMatchObject({ acknowledged: 3, claimed: 3, hasMore: false, steps: 2 });
    expect(runtime.verifyFtsSearchSyncReadiness).toHaveBeenCalledOnce();
    expect(drainOnce).toHaveBeenCalledTimes(2);
  });

  it('stops at the configured bound and reports remaining work', async () => {
    const { drainOnce, runtime } = createRuntime([drainResult({ hasMore: true })]);

    await expect(
      runElasticsearchFtsSearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).resolves.toMatchObject({ hasMore: true, steps: 1 });
    expect(drainOnce).toHaveBeenCalledOnce();
  });

  it('fails before draining when durable dead letters already exist', async () => {
    const { runtime } = createRuntime([]);
    const service = runtime.getFtsSearchSyncService();
    service.hasDeadLetters = vi.fn().mockResolvedValue(true);
    runtime.getFtsSearchSyncService = () => service;

    await expect(
      runElasticsearchFtsSearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).rejects.toThrow('blocked by existing dead-letter work');
    expect(service.drainOnce).not.toHaveBeenCalled();
  });

  it('fails when dead-letter work appears concurrently after draining', async () => {
    const { runtime } = createRuntime([drainResult()]);
    const service = runtime.getFtsSearchSyncService();
    service.hasDeadLetters = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    runtime.getFtsSearchSyncService = () => service;

    await expect(
      runElasticsearchFtsSearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).rejects.toThrow('blocked by dead-letter work');
  });

  it.each([
    [drainResult({ dead: 1, failed: 1 }), 'created dead-letter work'],
    [drainResult({ failed: 1 }), 'left retryable failed work'],
  ])('fails on unsettled drain results', async (result, message) => {
    const { runtime } = createRuntime([result]);

    await expect(
      runElasticsearchFtsSearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).rejects.toThrow(message);
  });
});

describe('runElasticsearchFtsSearchSyncCli', () => {
  it('requires explicit acknowledgement before loading the runtime', async () => {
    const loadRuntime = vi.fn();
    const logError = vi.fn();

    await expect(
      runElasticsearchFtsSearchSyncCli({ args: [], loadRuntime, logError }),
    ).resolves.toBe(1);
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      'Elasticsearch full-text search sync failed:',
      'Elasticsearch full-text search sync requires --yes after reviewing its documented effects',
    );
  });

  it('returns zero and emits only bounded numeric summaries after a successful drain', async () => {
    const { runtime } = createRuntime([drainResult()]);
    const logSuccess = vi.fn();

    await expect(
      runElasticsearchFtsSearchSyncCli({
        args: ['--yes'],
        loadRuntime: async () => runtime,
        logSuccess,
      }),
    ).resolves.toBe(0);
    expect(logSuccess).toHaveBeenLastCalledWith(
      expect.stringContaining('"type":"fts_search_sync_completed"'),
    );
  });
});

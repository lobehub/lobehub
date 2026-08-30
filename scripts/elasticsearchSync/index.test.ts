import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchSyncDrainResult } from '../../apps/server/src/services/searchSync';
import { runElasticsearchSync, runElasticsearchSyncCli } from './index';

const drainResult = (overrides: Partial<SearchSyncDrainResult> = {}): SearchSyncDrainResult => ({
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

const createRuntime = (results: SearchSyncDrainResult[]) => {
  const drainOnce = vi.fn();
  for (const result of results) drainOnce.mockResolvedValueOnce(result);
  const runtime = {
    getSearchSyncService: () => ({ drainOnce, hasDeadLetters: vi.fn().mockResolvedValue(false) }),
    verifyIncrementalSearchSyncReadiness: vi.fn().mockResolvedValue(undefined),
  };
  return { drainOnce, runtime };
};

describe('runElasticsearchSync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drains until the queue is empty within the configured bound', async () => {
    const { drainOnce, runtime } = createRuntime([
      drainResult({ hasMore: true }),
      drainResult({ acknowledged: 2, bulkItems: 2, claimed: 2 }),
    ]);

    await expect(
      runElasticsearchSync({ loadRuntime: async () => runtime, maxSteps: 8 }),
    ).resolves.toMatchObject({ acknowledged: 3, claimed: 3, hasMore: false, steps: 2 });
    expect(runtime.verifyIncrementalSearchSyncReadiness).toHaveBeenCalledOnce();
    expect(drainOnce).toHaveBeenCalledTimes(2);
  });

  it('stops at the configured bound and reports remaining work', async () => {
    const { drainOnce, runtime } = createRuntime([drainResult({ hasMore: true })]);

    await expect(
      runElasticsearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).resolves.toMatchObject({ hasMore: true, steps: 1 });
    expect(drainOnce).toHaveBeenCalledOnce();
  });

  it('fails before draining when durable dead letters already exist', async () => {
    const { runtime } = createRuntime([]);
    const service = runtime.getSearchSyncService();
    service.hasDeadLetters = vi.fn().mockResolvedValue(true);
    runtime.getSearchSyncService = () => service;

    await expect(
      runElasticsearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).rejects.toThrow('blocked by existing dead-letter work');
    expect(service.drainOnce).not.toHaveBeenCalled();
  });

  it('fails when dead-letter work appears concurrently after draining', async () => {
    const { runtime } = createRuntime([drainResult()]);
    const service = runtime.getSearchSyncService();
    service.hasDeadLetters = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    runtime.getSearchSyncService = () => service;

    await expect(
      runElasticsearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).rejects.toThrow('blocked by dead-letter work');
  });

  it.each([
    [drainResult({ dead: 1, failed: 1 }), 'created dead-letter work'],
    [drainResult({ failed: 1 }), 'left retryable failed work'],
  ])('fails on unsettled drain results', async (result, message) => {
    const { runtime } = createRuntime([result]);

    await expect(
      runElasticsearchSync({ loadRuntime: async () => runtime, maxSteps: 1 }),
    ).rejects.toThrow(message);
  });
});

describe('runElasticsearchSyncCli', () => {
  it('requires explicit acknowledgement before loading the runtime', async () => {
    const loadRuntime = vi.fn();
    const logError = vi.fn();

    await expect(runElasticsearchSyncCli({ args: [], loadRuntime, logError })).resolves.toBe(1);
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      'Elasticsearch sync failed:',
      'Elasticsearch sync requires --yes after reviewing its documented effects',
    );
  });

  it('returns zero and emits only bounded numeric summaries after a successful drain', async () => {
    const { runtime } = createRuntime([drainResult()]);
    const logSuccess = vi.fn();

    await expect(
      runElasticsearchSyncCli({
        args: ['--yes'],
        loadRuntime: async () => runtime,
        logSuccess,
      }),
    ).resolves.toBe(0);
    expect(logSuccess).toHaveBeenLastCalledWith(
      expect.stringContaining('"type":"search_sync_completed"'),
    );
  });
});

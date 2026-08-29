import { describe, expect, it, vi } from 'vitest';

import type { SearchReindexRunState } from '../../../packages/database/src/repositories/searchReindex';
import { prepareSearchReindexCapture } from '../captureSafety';

const state = (
  progress: Partial<SearchReindexRunState['progress'][number]> = {},
  captureVersion: string | null = null,
) =>
  ({
    progress: [
      {
        completedAt: null,
        cursor: null,
        entity: 'agents',
        failedCount: 0,
        indexedCount: 0,
        physicalIndex: 'lobehub-agents-v1',
        processedCount: 0,
        status: 'pending',
        ...progress,
      },
    ],
    run: { captureVersion, id: 'run-1' },
  }) as SearchReindexRunState;

const harness = (
  existing: SearchReindexRunState,
  before = { enabled: false, version: 'capture-0' as string | null },
  after = { enabled: true, version: 'capture-1' as string | null },
) => {
  const calls: string[] = [];
  return {
    calls,
    options: {
      enableCapture: vi.fn(async () => {
        calls.push('capture');
      }),
      existing,
      getCaptureState: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after),
      prepareIndices: vi.fn(async () => {
        calls.push('indices');
      }),
      setCaptureVersion: vi.fn(async (version: string) => {
        calls.push(`version:${version}`);
      }),
    },
  };
};

describe('search reindex capture safety', () => {
  it('prepares Elasticsearch before enabling capture for an untouched checkpoint', async () => {
    const { calls, options } = harness(state());

    await expect(prepareSearchReindexCapture(options)).resolves.toBeUndefined();

    expect(calls).toEqual(['indices', 'capture', 'version:capture-1']);
  });

  it.each([
    { cursor: 'agent-1', processedCount: 1, status: 'backfilling' as const },
    { completedAt: '2026-08-28T00:00:00.000Z', status: 'completed' as const },
  ])('rejects a disabled capture gap after durable progress', async (progress) => {
    const { options } = harness(state(progress, 'capture-1'), {
      enabled: false,
      version: 'capture-2',
    });

    await expect(prepareSearchReindexCapture(options)).rejects.toThrow(
      'Cannot resume a progressed reindex checkpoint while capture is disabled',
    );
    expect(options.prepareIndices).not.toHaveBeenCalled();
    expect(options.enableCapture).not.toHaveBeenCalled();
  });

  it('rejects a progressed checkpoint after capture was disabled and re-enabled', async () => {
    const { options } = harness(
      state({ cursor: 'agent-1', processedCount: 1, status: 'backfilling' }, 'capture-1'),
      { enabled: true, version: 'capture-3' },
    );

    await expect(prepareSearchReindexCapture(options)).rejects.toThrow(
      'Cannot resume a progressed reindex checkpoint after capture state changed',
    );
    expect(options.prepareIndices).not.toHaveBeenCalled();
  });

  it('allows a progressed checkpoint while its capture version remains active', async () => {
    const { calls, options } = harness(
      state({ cursor: 'agent-1', processedCount: 1, status: 'backfilling' }, 'capture-1'),
      { enabled: true, version: 'capture-1' },
      { enabled: true, version: 'capture-1' },
    );

    await expect(prepareSearchReindexCapture(options)).resolves.toBeUndefined();
    expect(calls).toEqual(['indices', 'capture', 'version:capture-1']);
  });

  it('does not enable capture when Elasticsearch index preparation fails', async () => {
    const { options } = harness(state(), { enabled: true, version: 'capture-1' });
    options.prepareIndices.mockRejectedValue(new Error('analysis-icu is unavailable'));

    await expect(prepareSearchReindexCapture(options)).rejects.toThrow(
      'analysis-icu is unavailable',
    );
    expect(options.enableCapture).not.toHaveBeenCalled();
  });
});

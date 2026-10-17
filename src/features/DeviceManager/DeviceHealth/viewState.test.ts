import { describe, expect, it } from 'vitest';

import { healthViewState, latestUsageView } from './viewState';

const series = (points: number) =>
  ({
    bucketMs: 1,
    cpuCount: 1,
    from: 0,
    memoryTotalBytes: 1,
    points: Array.from({ length: points }, (_, i) => ({ observedAt: i })),
    to: 1,
  }) as any;

describe('healthViewState', () => {
  // A rejected read used to render nothing forever — indistinguishable from loading.
  it('surfaces a failed read as an error, not as loading', () => {
    expect(healthViewState({ error: new Error('gateway down') })).toBe('error');
    expect(healthViewState({})).toBe('loading');
  });

  it('keeps showing cached data when a refresh fails', () => {
    expect(healthViewState({ data: series(3), error: new Error('x') })).toBe('ready');
  });

  it('tells a device that never reported apart from one with data', () => {
    expect(healthViewState({ data: series(0) })).toBe('empty');
  });
});

describe('latestUsageView', () => {
  const BUCKET = 5 * 60_000;
  const to = 1000 * BUCKET;
  const reported = {
    bucketMs: BUCKET,
    cpuCount: 8,
    from: to - 12 * BUCKET,
    memoryTotalBytes: 200,
    points: [
      {
        connected: true,
        cpuPercent: 14,
        load1: 1,
        memoryPercent: 35,
        memoryUsedBytes: 70,
        observedAt: to,
      },
    ],
    to,
  };

  // Before the first read resolved, the meters rendered as "no reading" (unlit
  // bars + em dashes) and then jumped to the real values.
  it('is loading while the first read is in flight', () => {
    expect(latestUsageView({})).toEqual({ loading: true });
  });

  it('resolves to the newest reading once loaded', () => {
    const view = latestUsageView({ data: reported });

    expect(view.loading).toBe(false);
    expect(!view.loading && view.latest).toMatchObject({ cpuPercent: 14, memoryPercent: 35 });
  });

  it('resolves to no reading, not loading, for a silent device or a failed read', () => {
    expect(latestUsageView({ data: series(0) })).toEqual({ latest: null, loading: false });
    expect(latestUsageView({ error: new Error('gateway down') })).toEqual({
      latest: null,
      loading: false,
    });
  });
});

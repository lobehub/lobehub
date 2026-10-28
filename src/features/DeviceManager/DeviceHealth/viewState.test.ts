import { describe, expect, it } from 'vitest';

import { currentUsage, healthViewState, latestUsageView } from './viewState';

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

describe('currentUsage', () => {
  const BUCKET = 5 * 60_000;
  const to = 1000 * BUCKET;
  const at = (observedAt: number) => ({
    bucketMs: BUCKET,
    cpuCount: 4,
    from: to - 144 * BUCKET,
    memoryTotalBytes: 100,
    points: [
      {
        connected: true,
        cpuPercent: 12,
        load1: 2,
        memoryPercent: 40,
        memoryUsedBytes: 40,
        observedAt,
      },
    ],
    to,
  });

  it('reads the newest point while it is recent, with load relative to the cores', () => {
    expect(currentUsage(at(to - BUCKET), to)).toEqual({
      cpuPercent: 12,
      loadPercent: 50,
      memoryPercent: 40,
    });
  });

  // A device that just reconnected still has last night's samples; the chip must not show them as now.
  it('drops a reading older than one bucket plus the upload grace', () => {
    expect(currentUsage(at(to - BUCKET - 11 * 60_000), to)).toBeNull();
  });

  // A persisted series painted on reload is fresh relative to its own `to`, but hours old now.
  it('judges age by the wall clock, not by the series end', () => {
    expect(currentUsage(at(to), to + 3 * 60 * 60_000)).toBeNull();
  });

  it('has nothing to read without data or samples', () => {
    expect(currentUsage(undefined, to)).toBeNull();
    expect(currentUsage(series(0), to)).toBeNull();
  });
});

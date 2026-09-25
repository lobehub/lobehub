import { describe, expect, it } from 'vitest';

import { healthViewState } from './viewState';

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

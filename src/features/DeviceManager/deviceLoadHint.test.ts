import { describe, expect, it } from 'vitest';

import { loadHint } from './deviceLoadHint';

describe('loadHint', () => {
  it('lights the meter by the busiest reading', () => {
    expect(loadHint({ cpuPercent: 4, loadPercent: 12, memoryPercent: 29 })).toEqual({
      level: 'normal',
      lit: 2,
      readings: [
        { metric: 'cpu', value: 4 },
        { metric: 'memory', value: 29 },
        { metric: 'load', value: 12 },
      ],
    });
  });

  it('turns yellow and red at the device-page thresholds', () => {
    expect(loadHint({ cpuPercent: 85, loadPercent: 10, memoryPercent: 10 })).toMatchObject({
      level: 'high',
      lit: 5,
    });
    expect(loadHint({ cpuPercent: 10, loadPercent: 10, memoryPercent: 97 })).toMatchObject({
      level: 'critical',
      lit: 5,
    });
  });

  it('lights one segment for any load and none for a true zero', () => {
    expect(loadHint({ cpuPercent: 1, loadPercent: 0, memoryPercent: 0 })?.lit).toBe(1);
    expect(loadHint({ cpuPercent: 0, loadPercent: 0, memoryPercent: 0 })?.lit).toBe(0);
  });

  it('caps an overloaded machine at a full meter', () => {
    expect(loadHint({ cpuPercent: 10, loadPercent: 250, memoryPercent: 10 })).toMatchObject({
      level: 'critical',
      lit: 5,
    });
  });

  it('ignores a reading the platform does not have', () => {
    const hint = loadHint({ cpuPercent: 10, loadPercent: null, memoryPercent: 20 });
    expect(hint?.readings.map((r) => r.metric)).toEqual(['cpu', 'memory']);
  });

  it('has nothing to show without a reading', () => {
    expect(loadHint(null)).toBeNull();
    expect(loadHint({ cpuPercent: null, loadPercent: null, memoryPercent: null })).toBeNull();
  });
});

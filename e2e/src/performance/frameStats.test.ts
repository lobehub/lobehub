import { describe, expect, it } from 'vitest';

import { summarizeFrames } from './frameStats';

describe('summarizeFrames', () => {
  it('reports steady 60 Hz frames without long frames', () => {
    const timestamps = Array.from({ length: 61 }, (_, i) => i * 16.7);

    expect(summarizeFrames(timestamps)).toEqual({
      frames: 61,
      longFrames: 0,
      maxGapMs: 16.7,
      p95GapMs: 16.7,
    });
  });

  it('counts each stall above 50 ms and keeps the worst one as the max gap', () => {
    const timestamps = [0, 16, 32, 132, 148, 164, 244];

    const stats = summarizeFrames(timestamps);

    expect(stats.longFrames).toBe(2);
    expect(stats.maxGapMs).toBe(100);
  });

  it('uses the nearest-rank 95th percentile so one stall in 20 gaps sets it', () => {
    const gaps = [...Array.from({ length: 19 }, () => 10), 90];
    const timestamps = gaps.reduce<number[]>((acc, gap) => [...acc, acc.at(-1)! + gap], [0]);

    expect(summarizeFrames(timestamps).p95GapMs).toBe(10);
    expect(summarizeFrames([...timestamps, timestamps.at(-1)! + 90]).p95GapMs).toBe(90);
  });

  it('returns zeros when fewer than two frames were sampled', () => {
    expect(summarizeFrames([5])).toEqual({ frames: 1, longFrames: 0, maxGapMs: 0, p95GapMs: 0 });
  });
});

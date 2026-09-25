import type { DeviceMetricPoint } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildHealthTimeline, groupStripBlocks, type HealthSlot } from './buildHealthTimeline';

const MIN = 60_000;
const BUCKET = 5 * MIN;
const to = 1000 * BUCKET;
const from = to - 12 * BUCKET;

const point = (bucketsAgo: number, patch: Partial<DeviceMetricPoint> = {}): DeviceMetricPoint => ({
  connected: true,
  cpuPercent: 10,
  load1: 1,
  memoryPercent: 50,
  memoryUsedBytes: 100,
  observedAt: to - bucketsAgo * BUCKET,
  ...patch,
});

const build = (points: DeviceMetricPoint[], cpuCount: number | null = 8) =>
  buildHealthTimeline({ bucketMs: BUCKET, cpuCount, from, memoryTotalBytes: 200, points, to });

describe('buildHealthTimeline', () => {
  it('lays out one slot per bucket across the window', () => {
    const { slots } = build([]);

    expect(slots).toHaveLength(13);
    expect(slots[0].start).toBe(from);
    expect(slots.at(-1)!.start).toBe(to);
  });

  it('separates running-but-disconnected from no data, and groups contiguous stretches', () => {
    const { stretches } = build([
      point(12),
      point(11, { connected: false }),
      point(10, { connected: false }),
      // 9 … 7 buckets ago: no samples
      point(6),
      point(5),
      point(4),
      point(3),
    ]);

    expect(stretches).toEqual([
      { end: to - 9 * BUCKET, start: to - 11 * BUCKET, status: 'offline' },
      { end: to - 6 * BUCKET, start: to - 9 * BUCKET, status: 'missing' },
    ]);
  });

  it('does not call the not-yet-uploaded tail missing', () => {
    const { slots, stretches } = build([point(12), point(3)]);

    expect(slots.slice(-3).map((s) => s.status)).toEqual(['pending', 'pending', 'pending']);
    expect(stretches.at(-1)!.end).toBe(to - 3 * BUCKET);
  });

  it('reports the newest readings and a load ceiling of at least the core count', () => {
    const timeline = build([point(4, { load1: 3 }), point(3, { cpuPercent: 90, load1: 12.4 })]);

    expect(timeline.latest).toEqual({ cpuPercent: 90, load1: 12.4, memoryPercent: 50 });
    expect(timeline.loadCeiling).toBe(13);
    expect(build([point(3, { load1: 2 })]).loadCeiling).toBe(8);
  });
});

describe('groupStripBlocks', () => {
  const slot = (i: number, status: HealthSlot['status']): HealthSlot => ({
    cpuPercent: null,
    load1: null,
    memoryPercent: null,
    memoryUsedBytes: null,
    start: i * BUCKET,
    status,
  });

  it('keeps a disconnect visible and reads partial running as running', () => {
    const blocks = groupStripBlocks(
      [
        slot(0, 'missing'),
        slot(1, 'online'),
        slot(2, 'online'),
        slot(3, 'online'),
        slot(4, 'offline'),
        slot(5, 'online'),
        slot(6, 'missing'),
        slot(7, 'pending'),
      ],
      BUCKET,
      3,
    );

    expect(blocks).toEqual([
      { end: 3 * BUCKET, start: 0, status: 'online' },
      { end: 6 * BUCKET, start: 3 * BUCKET, status: 'offline' },
      { end: 8 * BUCKET, start: 6 * BUCKET, status: 'pending' },
    ]);
  });
});

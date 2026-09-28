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

  it('separates running-but-disconnected from no data', () => {
    const { slots } = build([
      point(12),
      point(11, { connected: false }),
      // 10 … 7 buckets ago: no samples
      point(6),
      point(3),
    ]);

    const statusAt = (bucketsAgo: number) =>
      slots.find((s) => s.start === to - bucketsAgo * BUCKET)!.status;
    expect(statusAt(11)).toBe('offline');
    expect(statusAt(9)).toBe('missing');
    expect(statusAt(6)).toBe('online');
  });

  it('does not call the not-yet-uploaded tail missing', () => {
    const { slots } = build([point(12), point(3)]);

    expect(slots.slice(-3).map((s) => s.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('reports load as a share of the cores, with a chart ceiling of at least 100%', () => {
    const timeline = build([point(4, { load1: 4 }), point(3, { cpuPercent: 90, load1: 12 })]);

    expect(timeline.latest).toEqual({ cpuPercent: 90, loadPercent: 150, memoryPercent: 50 });
    expect(timeline.loadCeiling).toBe(150);
    expect(build([point(3, { load1: 2 })]).loadCeiling).toBe(100);
  });
});

describe('groupStripBlocks', () => {
  const slot = (
    i: number,
    status: HealthSlot['status'],
    usage: Partial<HealthSlot> = {},
  ): HealthSlot => ({
    cpuPercent: null,
    loadPercent: null,
    memoryPercent: null,
    memoryUsedBytes: null,
    start: i * BUCKET,
    status,
    ...usage,
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
      3 * BUCKET,
    );

    expect(blocks.map(({ end, start, status }) => ({ end, start, status }))).toEqual([
      { end: 3 * BUCKET, start: 0, status: 'online' },
      { end: 6 * BUCKET, start: 3 * BUCKET, status: 'offline' },
      { end: 8 * BUCKET, start: 6 * BUCKET, status: 'pending' },
    ]);
  });

  it('aligns blocks to wall-clock boundaries rather than the window start', () => {
    const blocks = groupStripBlocks([slot(1, 'online'), slot(2, 'online'), slot(3, 'online')], BUCKET, 2 * BUCKET);

    expect(blocks.map(({ end, start }) => ({ end, start }))).toEqual([
      { end: 2 * BUCKET, start: BUCKET },
      { end: 4 * BUCKET, start: 2 * BUCKET },
    ]);
  });

  it('carries the highest reading of each metric in the block', () => {
    const [block] = groupStripBlocks(
      [
        slot(0, 'online', { cpuPercent: 40, loadPercent: 95, memoryPercent: 60 }),
        slot(1, 'online', { cpuPercent: 80, memoryPercent: 55 }),
      ],
      BUCKET,
      2 * BUCKET,
    );

    expect(block.peak).toEqual({ cpuPercent: 80, loadPercent: 95, memoryPercent: 60 });
  });
});

import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import {
  buildSessionGrid,
  buildWindowStats,
  type QuotaWindowSpan,
  utilizationLevelOf,
} from './quotaCalendarModel';

const hour = 60 * 60 * 1000;
const at = (value: string) => dayjs(value).valueOf();

const windowAt = (
  start: string,
  utilization: number,
  rateLimitedAt: number | null = null,
): QuotaWindowSpan => ({
  peakUtilization: utilization,
  rateLimitedAt,
  resetsAt: at(start) + 5 * hour,
  windowStartAt: at(start),
});

describe('quota calendar window statistics', () => {
  it('merges the live reading into history and attributes spend to each window', () => {
    const historical = windowAt('2026-08-08T08:00:00', 60, at('2026-08-08T10:00:00'));
    const storedLive = windowAt('2026-08-09T08:00:00', 35);
    const live = windowAt('2026-08-09T08:00:00', 72);

    const stats = buildWindowStats(
      [historical, storedLive],
      live,
      [
        { cost: 1.25, occurredAt: at('2026-08-08T09:00:00'), tokens: 1000 },
        { cost: 2.5, occurredAt: at('2026-08-09T09:00:00'), tokens: 2000 },
      ],
      at('2026-08-09T10:00:00'),
    );

    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({ cost: 2.5, isLive: true, peakUtilization: 72, tokens: 2000 });
    expect(stats[1]).toMatchObject({
      cost: 1.25,
      isLive: false,
      rateLimitedAt: at('2026-08-08T10:00:00'),
      tokens: 1000,
    });
  });

  it('deduplicates provider reset jitter within one logical window', () => {
    const first = windowAt('2026-08-09T08:00:00', 35);
    const jittered = {
      ...windowAt('2026-08-09T08:00:00', 68),
      rateLimitedAt: at('2026-08-09T10:00:00'),
      resetsAt: first.resetsAt + 90_000,
    };

    const stats = buildWindowStats([first, jittered], null, [], at('2026-08-10T00:00:00'));

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      peakUtilization: 68,
      rateLimitedAt: at('2026-08-09T10:00:00'),
      resetsAt: jittered.resetsAt,
    });
  });

  it('lays session windows out by local day and chronological slot', () => {
    const stats = buildWindowStats(
      [
        windowAt('2026-08-08T13:00:00', 80),
        windowAt('2026-08-08T07:00:00', 20),
        windowAt('2026-08-09T08:00:00', 50),
      ],
      null,
      [],
      at('2026-08-10T00:00:00'),
    );
    const grid = buildSessionGrid(stats, dayjs('2026-08-09'), 2);

    expect(grid.rowCount).toBe(2);
    expect(grid.columns.map((column) => column.key)).toEqual(['2026-08-08', '2026-08-09']);
    expect(grid.columns[0].slots.map((slot) => slot?.peakUtilization)).toEqual([20, 80]);
    expect(grid.columns[1].slots.map((slot) => slot?.peakUtilization ?? null)).toEqual([50, null]);
  });

  it.each([
    [0, 0],
    [1, 1],
    [24, 1],
    [25, 2],
    [49, 2],
    [50, 3],
    [79, 3],
    [80, 4],
    [100, 4],
  ])('maps %s%% utilization to level %s', (utilization, level) => {
    expect(utilizationLevelOf(utilization)).toBe(level);
  });
});

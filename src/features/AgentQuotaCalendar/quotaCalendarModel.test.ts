import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import {
  buildDailyHeatLevels,
  buildDailySpend,
  buildSessionGrid,
  buildWindowStats,
  isCalendarMonthAvailable,
  type QuotaWindowSpan,
  selectQuotaAccount,
  shouldShowHeatDot,
  trackedCostOf,
  utilizationLevelOf,
  utilizationStatusOf,
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
        { cost: null, occurredAt: at('2026-08-09T09:30:00'), tokens: 500 },
      ],
      at('2026-08-09T10:00:00'),
    );

    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({
      cost: 2.5,
      hasUnpricedTurn: true,
      isLive: true,
      peakUtilization: 72,
      tokens: 2500,
    });
    expect(stats[1]).toMatchObject({
      cost: 1.25,
      hasUnpricedTurn: false,
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

  it('shows a heat dot only for positive, non-rate-limited days', () => {
    expect(shouldShowHeatDot(0, false)).toBe(false);
    expect(shouldShowHeatDot(1, false)).toBe(true);
    expect(shouldShowHeatDot(4, false)).toBe(true);
    expect(shouldShowHeatDot(4, true)).toBe(false);
  });

  it('falls back to provider burn per day when ledger exists only on other days', () => {
    const spend = buildDailySpend([
      { cost: 2, occurredAt: at('2026-08-08T09:00:00'), tokens: 2000 },
    ]);
    const burn = new Map([
      ['2026-08-08', 20],
      ['2026-08-09', 60],
    ]);

    expect(buildDailyHeatLevels(spend, burn)).toEqual(
      new Map([
        ['2026-08-08', 4],
        ['2026-08-09', 4],
      ]),
    );
  });

  it('does not fall back to a different quota account', () => {
    const accounts = [
      { externalAccountId: 'account-a', id: 'a' },
      { externalAccountId: 'account-b', id: 'b' },
    ];

    expect(selectQuotaAccount(accounts, 'missing')).toBeUndefined();
    expect(selectQuotaAccount(accounts)).toBeUndefined();
    expect(selectQuotaAccount([accounts[0]])).toEqual(accounts[0]);
  });

  it('limits calendar navigation to the two fully loaded months', () => {
    const now = at('2026-08-09T12:00:00');

    expect(isCalendarMonthAvailable(dayjs('2026-08-01'), now)).toBe(true);
    expect(isCalendarMonthAvailable(dayjs('2026-07-01'), now)).toBe(true);
    expect(isCalendarMonthAvailable(dayjs('2026-06-01'), now)).toBe(false);
    expect(isCalendarMonthAvailable(dayjs('2026-09-01'), now)).toBe(false);
  });

  it('distinguishes exact, lower-bound, and unknown costs', () => {
    expect(trackedCostOf({ cost: 2, hasUnpricedTurn: false })).toEqual({
      cost: 2,
      kind: 'exact',
    });
    expect(trackedCostOf({ cost: 2, hasUnpricedTurn: true })).toEqual({
      cost: 2,
      kind: 'lower-bound',
    });
    expect(trackedCostOf({ cost: 0, hasUnpricedTurn: true })).toEqual({ kind: 'unknown' });
  });

  it.each([
    [0, 'safe'],
    [79, 'safe'],
    [80, 'warning'],
    [99, 'warning'],
    [100, 'error'],
    [120, 'error'],
  ] as const)('maps %s%% utilization to %s pressure', (utilization, status) => {
    expect(utilizationStatusOf(utilization)).toBe(status);
  });
});

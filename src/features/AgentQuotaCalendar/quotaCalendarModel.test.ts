import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';
import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import {
  buildBurnSeries,
  buildDailyBurn,
  buildDailyHeatLevels,
  buildDailySpend,
  buildSessionGrid,
  buildWindowStats,
  currentWindow,
  discoverSessionBuckets,
  formatTokens,
  isCalendarMonthAvailable,
  matchesSeries,
  MONTHLY_WINDOW_MS,
  type QuotaSeriesKey,
  type QuotaWindowSpan,
  selectProviderQuotaAccount,
  selectQuotaAccount,
  seriesId,
  SESSION_SERIES,
  shouldShowHeatDot,
  trackedCostOf,
  utilizationLevelOf,
  utilizationStatusOf,
  windowMsOf,
  windowSeriesIdOf,
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

  it('selects the calendar account only inside the pool of the provider it opened for', () => {
    const accounts = [
      { externalAccountId: 'claude-ext', id: 'acc-claude', provider: 'claude-code' },
      { externalAccountId: 'codex-ext', id: 'acc-codex', provider: 'codex' },
      { externalAccountId: 'kimi-a', id: 'acc-kimi-a', provider: 'kimi-code' },
      { externalAccountId: 'kimi-b', id: 'acc-kimi-b', provider: 'kimi-code' },
    ];

    expect(selectProviderQuotaAccount(accounts, 'kimi-code', 'kimi-b')).toEqual(accounts[3]);
    expect(selectProviderQuotaAccount(accounts, 'codex')).toEqual(accounts[1]);
    // Two kimi accounts and no explicit choice: ambiguous, not "any of them".
    expect(selectProviderQuotaAccount(accounts, 'kimi-code')).toBeUndefined();
    // No account of the opened provider: unavailable, never another provider's.
    expect(selectProviderQuotaAccount(accounts, 'kimi-code', 'claude-ext')).toBeUndefined();
    expect(selectProviderQuotaAccount([accounts[0]], 'codex')).toBeUndefined();
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

describe('monthly quota series', () => {
  const monthlySeries = (scopeKey: string): QuotaSeriesKey => ({ scopeKey, type: 'monthly' });
  const monthReading = (limitType: string, capturedAt: number, resetsAt: number | null) => ({
    capturedAt,
    limitType,
    resetsAt,
    scopeKey: '',
    utilization: 40,
    windowMinutes: 43_200,
  });

  it('keeps month buckets out of the session and weekly series', () => {
    const total = monthReading('month_total', 0, null);

    expect(matchesSeries(total, { scopeKey: '', type: 'session' })).toBe(false);
    expect(matchesSeries(total, { scopeKey: '', type: 'weekly' })).toBe(false);
    expect(matchesSeries(total, monthlySeries('month_total'))).toBe(true);
    // month_total and month_code are distinct quotas, not one monthly bucket.
    expect(matchesSeries(monthReading('month_code', 0, null), monthlySeries('month_total'))).toBe(
      false,
    );
    expect(matchesSeries(monthReading('month_code', 0, null), monthlySeries('month_code'))).toBe(
      true,
    );
  });

  it('buckets monthly windows by limitType instead of folding them into session', () => {
    expect(windowSeriesIdOf('month_total', '')).toBe('monthly:month_total');
    expect(windowSeriesIdOf('month_code', '')).toBe('monthly:month_code');
    expect(windowSeriesIdOf('weekly_all', '')).toBe('weekly:');
    expect(windowSeriesIdOf('weekly_scoped', 'Fable')).toBe('weekly:Fable');
    expect(windowSeriesIdOf('session', '')).toBe('session:');
    expect(windowSeriesIdOf('five_hour', '')).toBe('session:');
  });

  it('spans the 30-day window Kimi reports for its monthly buckets', () => {
    expect(windowMsOf(monthlySeries('month_total'))).toBe(MONTHLY_WINDOW_MS);
    expect(seriesId(monthlySeries('month_total'))).toBe('monthly:month_total');
  });

  it('finds the live monthly window from readings', () => {
    const now = at('2026-08-09T12:00:00');
    const resetsAt = at('2026-09-01T00:00:00');

    const live = currentWindow(
      [monthReading('month_total', now - 60_000, resetsAt)],
      monthlySeries('month_total'),
      now,
    );

    expect(live).toMatchObject({
      peakUtilization: 40,
      resetsAt,
      windowStartAt: resetsAt - MONTHLY_WINDOW_MS,
    });
  });
});

describe('scoped session buckets (codex)', () => {
  const OTHER_SERIES: QuotaSeriesKey = { scopeKey: 'codex_other', type: 'session' };

  const sessionReading = (
    scopeKey: string,
    capturedAt: number,
    resetsAt: number | null,
    utilization: number,
    windowMinutes = 300,
    limitName: string | null = null,
  ): QuotaLimitReading => ({
    capturedAt,
    limitName,
    limitType: 'session',
    resetsAt,
    scopeKey,
    utilization,
    windowMinutes,
  });

  it('keeps session buckets with distinct scopeKeys apart', () => {
    const baseReading = sessionReading('', 0, null, 40);
    const scopedReading = sessionReading('codex_other', 0, null, 40);

    expect(matchesSeries(baseReading, SESSION_SERIES)).toBe(true);
    expect(matchesSeries(scopedReading, SESSION_SERIES)).toBe(false);
    expect(matchesSeries(scopedReading, OTHER_SERIES)).toBe(true);
    expect(matchesSeries(baseReading, OTHER_SERIES)).toBe(false);
    // Claude's legacy alias still lands in the base session series.
    expect(matchesSeries({ ...baseReading, limitType: 'five_hour' }, SESSION_SERIES)).toBe(true);
  });

  it('buckets session windows by scopeKey instead of merging them', () => {
    expect(windowSeriesIdOf('session', '')).toBe('session:');
    expect(windowSeriesIdOf('session', 'codex_other')).toBe('session:codex_other');
    expect(windowSeriesIdOf('five_hour', 'codex_other')).toBe('session:codex_other');
  });

  it('sizes a bucket window from its own windowMinutes, not the 5-hour default', () => {
    const now = at('2026-08-09T12:00:00');
    const resetsAt = at('2026-08-09T12:40:00');

    const live = currentWindow(
      [sessionReading('codex_other', now - 60_000, resetsAt, 55, 60)],
      OTHER_SERIES,
      now,
    );

    expect(live).toMatchObject({ resetsAt, windowStartAt: resetsAt - hour });
  });

  it('finds the live window per bucket, not across buckets', () => {
    const now = at('2026-08-09T12:00:00');
    const baseResetsAt = at('2026-08-09T15:00:00');
    const otherResetsAt = at('2026-08-09T13:00:00');
    const readings = [
      sessionReading('', now - 60_000, baseResetsAt, 30),
      sessionReading('codex_other', now - 30_000, otherResetsAt, 70, 60),
    ];

    expect(currentWindow(readings, SESSION_SERIES, now)).toMatchObject({
      resetsAt: baseResetsAt,
      windowStartAt: baseResetsAt - 5 * hour,
    });
    expect(currentWindow(readings, OTHER_SERIES, now)).toMatchObject({
      resetsAt: otherResetsAt,
      windowStartAt: otherResetsAt - hour,
    });
  });

  it('burns each bucket from its own consecutive samples', () => {
    const t0 = at('2026-08-09T08:00:00');
    const baseResetsAt = at('2026-08-09T13:00:00');
    const readings = [
      sessionReading('', t0, baseResetsAt, 10),
      sessionReading('codex_other', t0 + 10 * 60_000, at('2026-08-09T09:00:00'), 60, 60),
      sessionReading('', t0 + 20 * 60_000, baseResetsAt, 30),
    ];

    // 10 -> 30 inside one window: 20 points, unpolluted by the other bucket's 60.
    expect(buildDailyBurn(readings, SESSION_SERIES)).toEqual(new Map([['2026-08-09', 20]]));
    // A single sample has no delta to attribute.
    expect(buildDailyBurn(readings, OTHER_SERIES).size).toBe(0);
  });

  it("drops deltas spanning more than the bucket's own window", () => {
    const t0 = at('2026-08-09T08:00:00');
    const readings = [
      sessionReading('codex_other', t0, t0 + hour, 80, 60),
      sessionReading('codex_other', t0 + 2 * hour, t0 + 3 * hour, 20, 60),
    ];

    // A 2-hour gap inside a 60-minute bucket can hide entire windows.
    expect(buildDailyBurn(readings, OTHER_SERIES).size).toBe(0);
  });

  it('draws the burn curve from one bucket only', () => {
    const resetsAt = at('2026-08-09T15:00:00');
    const window: QuotaWindowSpan = {
      peakUtilization: 40,
      rateLimitedAt: null,
      resetsAt,
      windowStartAt: resetsAt - 5 * hour,
    };
    const readings = [
      sessionReading('', resetsAt - 4 * hour, resetsAt, 20),
      sessionReading('codex_other', resetsAt - 3 * hour, resetsAt, 90, 60),
      sessionReading('', resetsAt - 2 * hour, resetsAt, 40),
    ];

    expect(buildBurnSeries(readings, SESSION_SERIES, window).map((p) => p.utilization)).toEqual([
      0, 20, 40,
    ]);
  });

  it('enumerates one series option per session bucket, base first', () => {
    const buckets = discoverSessionBuckets([
      sessionReading('codex_other', 0, null, 10, 60, 'GPT-5 Codex'),
      sessionReading('', 0, null, 20),
      sessionReading('codex_spark', 0, null, 30, 60),
    ]);

    expect(buckets).toEqual([
      { limitName: null, scopeKey: '' },
      { limitName: 'GPT-5 Codex', scopeKey: 'codex_other' },
      { limitName: null, scopeKey: 'codex_spark' },
    ]);
  });
});

describe('formatTokens', () => {
  it('keeps sub-billion counts in K and M', () => {
    expect(formatTokens(820)).toBe('820');
    expect(formatTokens(340_000)).toBe('340K');
    expect(formatTokens(1_200_000)).toBe('1.2M');
    expect(formatTokens(585_000_000)).toBe('585M');
    expect(formatTokens(999_400_000)).toBe('999M');
  });

  it('steps up to B past a billion instead of printing four-digit M', () => {
    expect(formatTokens(1_000_000_000)).toBe('1.0B');
    expect(formatTokens(1_319_000_000)).toBe('1.3B');
    expect(formatTokens(3_136_000_000)).toBe('3.1B');
    expect(formatTokens(12_500_000_000)).toBe('13B');
  });
});

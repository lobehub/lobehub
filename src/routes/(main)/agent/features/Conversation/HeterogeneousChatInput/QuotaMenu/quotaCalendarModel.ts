import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';
import { CLAUDE_WEEKLY_WINDOW_SECONDS } from '@lobechat/heterogeneous-agents/quota';
import dayjs from 'dayjs';

/**
 * Pure read-model helpers for the quota usage calendar: daily burn heat from
 * the snapshot time series, plus the burn-down curve and exhaustion projection
 * for one weekly window. No React, no fetching — kept apart so the shapes are
 * unit-testable.
 */

export const WEEKLY_WINDOW_MS = CLAUDE_WEEKLY_WINDOW_SECONDS * 1000;

/** Two provider-reported reset instants for the same window may jitter a bit. */
const RESET_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

/** Even pace burns the weekly window in exactly 7 days. */
export const EVEN_PACE_DAILY_PERCENT = 100 / 7;

export const dayKeyOf = (time: number) => dayjs(time).format('YYYY-MM-DD');

export interface BurnPoint {
  time: number;
  utilization: number;
}

export interface WeeklyWindowSpan {
  peakUtilization: number;
  rateLimitedAt: number | null;
  resetsAt: number;
  windowStartAt: number;
}

/** A weekly series is identified by its scope: `''` = account-wide. */
export const isWeeklySeriesReading = (reading: QuotaLimitReading, scopeKey: string) =>
  reading.limitType.startsWith('weekly') && (reading.scopeKey || '') === scopeKey;

const sortByCapturedAt = (readings: QuotaLimitReading[]) =>
  [...readings].sort((a, b) => a.capturedAt - b.capturedAt);

const sameWindow = (a: QuotaLimitReading, b: QuotaLimitReading) =>
  a.resetsAt != null && b.resetsAt != null
    ? Math.abs(a.resetsAt - b.resetsAt) < RESET_MATCH_TOLERANCE_MS
    : b.utilization >= a.utilization;

/**
 * Percentage points of the window burned per local day, from consecutive
 * snapshot deltas. A rollover between two samples restarts the meter, so the
 * new sample's utilization *is* the burn since reset. Negative deltas inside
 * one window (a provider correction) count as zero rather than negative burn.
 */
export const buildDailyBurn = (
  readings: QuotaLimitReading[],
  scopeKey: string,
): Map<string, number> => {
  const series = sortByCapturedAt(readings.filter((r) => isWeeklySeriesReading(r, scopeKey)));
  const burnByDay = new Map<string, number>();

  for (const [index, current] of series.entries()) {
    if (index === 0) continue;
    const previous = series[index - 1];
    // A gap longer than one full window can hide entire windows — attributing
    // its delta to one day would paint a false spike.
    if (current.capturedAt - previous.capturedAt > WEEKLY_WINDOW_MS) continue;

    const burn = sameWindow(previous, current)
      ? Math.max(0, current.utilization - previous.utilization)
      : current.utilization;
    if (burn <= 0) continue;

    const key = dayKeyOf(current.capturedAt);
    burnByDay.set(key, (burnByDay.get(key) ?? 0) + burn);
  }

  return burnByDay;
};

/**
 * Heat level for a day's burn, calibrated against the even 7-day pace
 * (~14.3 %/day): level 4 means the day alone burned faster than sustainable.
 */
export const burnLevelOf = (burn: number): 0 | 1 | 2 | 3 | 4 => {
  if (burn <= 0) return 0;
  if (burn <= 5) return 1;
  if (burn <= 10) return 2;
  if (burn <= EVEN_PACE_DAILY_PERCENT) return 3;
  return 4;
};

/** The weekly window that is live right now, from the newest future reset. */
export const currentWeeklyWindow = (
  readings: QuotaLimitReading[],
  scopeKey: string,
  now: number,
): WeeklyWindowSpan | null => {
  let newest: QuotaLimitReading | null = null;
  for (const reading of readings) {
    if (!isWeeklySeriesReading(reading, scopeKey)) continue;
    if (reading.resetsAt == null || reading.resetsAt <= now) continue;
    if (!newest || reading.capturedAt > newest.capturedAt) newest = reading;
  }
  if (!newest) return null;

  return {
    peakUtilization: newest.utilization,
    rateLimitedAt: null,
    resetsAt: newest.resetsAt!,
    windowStartAt: newest.resetsAt! - WEEKLY_WINDOW_MS,
  };
};

/**
 * The burn-down polyline for one window: its snapshot readings in capture
 * order, anchored at (windowStart, 0) — a window is refilled by definition at
 * its start instant.
 */
export const buildBurnSeries = (
  readings: QuotaLimitReading[],
  scopeKey: string,
  window: WeeklyWindowSpan,
): BurnPoint[] => {
  const points = sortByCapturedAt(
    readings.filter(
      (r) =>
        isWeeklySeriesReading(r, scopeKey) &&
        r.capturedAt >= window.windowStartAt &&
        r.capturedAt <= window.resetsAt &&
        (r.resetsAt == null || Math.abs(r.resetsAt - window.resetsAt) < RESET_MATCH_TOLERANCE_MS),
    ),
  ).map((r) => ({ time: r.capturedAt, utilization: Math.min(100, Math.max(0, r.utilization)) }));

  return [{ time: window.windowStartAt, utilization: 0 }, ...points];
};

export type BurnProjection =
  | { exhaustAt: number; kind: 'exhaust' }
  | { kind: 'exhausted' }
  | { kind: 'safe'; projectedEndUtilization: number };

/** How far back "current pace" looks before falling back to the whole window. */
const PACE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Project where the current pace lands: the reference sample is the newest
 * point at least one day old (so an idle night flattens the pace instead of
 * the whole week's average hiding a hot streak), falling back to the window
 * anchor when the window is younger than a day.
 */
export const projectBurnout = (points: BurnPoint[], window: WeeklyWindowSpan): BurnProjection => {
  const last = points.at(-1);
  if (!last || points.length < 2) return { kind: 'safe', projectedEndUtilization: 0 };
  if (last.utilization >= 100) return { kind: 'exhausted' };

  let reference = points[0];
  for (const point of points) {
    if (point.time <= last.time - PACE_LOOKBACK_MS) reference = point;
  }
  const elapsed = last.time - reference.time;
  const slope = elapsed > 0 ? (last.utilization - reference.utilization) / elapsed : 0;
  if (slope <= 0) return { kind: 'safe', projectedEndUtilization: last.utilization };

  const exhaustAt = last.time + (100 - last.utilization) / slope;
  if (exhaustAt <= window.resetsAt) return { exhaustAt, kind: 'exhaust' };

  return {
    kind: 'safe',
    projectedEndUtilization: Math.min(
      100,
      last.utilization + slope * (window.resetsAt - last.time),
    ),
  };
};

export interface CalendarDayCell {
  date: dayjs.Dayjs;
  inMonth: boolean;
  key: string;
}

/** Six Monday-start weeks covering the given month. */
export const buildMonthGrid = (month: dayjs.Dayjs): CalendarDayCell[] => {
  const firstOfMonth = month.startOf('month');
  // dayjs day(): 0 = Sunday. Shift so the grid starts on Monday.
  const offset = (firstOfMonth.day() + 6) % 7;
  const gridStart = firstOfMonth.subtract(offset, 'day');

  return Array.from({ length: 42 }, (_, index) => {
    const date = gridStart.add(index, 'day');
    return { date, inMonth: date.month() === month.month(), key: date.format('YYYY-MM-DD') };
  });
};

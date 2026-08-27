import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';
import {
  CLAUDE_SESSION_WINDOW_SECONDS,
  CLAUDE_WEEKLY_WINDOW_SECONDS,
} from '@lobechat/heterogeneous-agents/quota';
import dayjs from 'dayjs';

/**
 * Pure read-model helpers for the quota usage calendar: daily token/cost spend
 * from the usage ledger, quota headroom from the snapshot time series, and the
 * burn-down curve plus exhaustion projection for one window. No React, no
 * fetching — kept apart so the shapes are unit-testable.
 *
 * Two limit windows matter to a coding agent and both are first-class here: the
 * 5-hour session window it actually works in, and the 7-day weekly window that
 * caps the week.
 */

export const WEEKLY_WINDOW_MS = CLAUDE_WEEKLY_WINDOW_SECONDS * 1000;
export const SESSION_WINDOW_MS = CLAUDE_SESSION_WINDOW_SECONDS * 1000;

/** Two provider-reported reset instants for the same window may jitter a bit. */
const RESET_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

export const dayKeyOf = (time: number) => dayjs(time).format('YYYY-MM-DD');

/** Which limit series a calendar view is reading. */
export interface QuotaSeriesKey {
  /** `''` for the account-wide weekly; a model name for a scoped weekly. */
  scopeKey: string;
  type: 'session' | 'weekly';
}

export const SESSION_SERIES: QuotaSeriesKey = { scopeKey: '', type: 'session' };

export const seriesId = (series: QuotaSeriesKey) => `${series.type}:${series.scopeKey}`;

export const windowMsOf = (series: QuotaSeriesKey) =>
  series.type === 'session' ? SESSION_WINDOW_MS : WEEKLY_WINDOW_MS;

export interface BurnPoint {
  time: number;
  utilization: number;
}

export interface QuotaWindowSpan {
  peakUtilization: number;
  rateLimitedAt: number | null;
  resetsAt: number;
  windowStartAt: number;
}

/** One assistant turn's spend, as returned by `agentQuota.listUsageTurns`. */
export interface UsageTurn {
  cost: number | null;
  model?: string | null;
  occurredAt: number;
  tokens: number;
}

export interface DaySpend {
  cost: number;
  /** Turns whose model the price bank did not know — cost is a lower bound. */
  hasUnpricedTurn: boolean;
  tokens: number;
}

export type TrackedCost =
  { cost: number; kind: 'exact' } | { cost: number; kind: 'lower-bound' } | { kind: 'unknown' };

export const trackedCostOf = (spend: Pick<DaySpend, 'cost' | 'hasUnpricedTurn'>): TrackedCost => {
  if (!spend.hasUnpricedTurn) return { cost: spend.cost, kind: 'exact' };
  if (spend.cost > 0) return { cost: spend.cost, kind: 'lower-bound' };
  return { kind: 'unknown' };
};

interface QuotaAccountCandidate {
  externalAccountId?: string | null;
}

export const selectQuotaAccount = <T extends QuotaAccountCandidate>(
  accounts: T[],
  externalAccountId?: string,
): T | undefined => {
  if (externalAccountId)
    return accounts.find((candidate) => candidate.externalAccountId === externalAccountId);
  return accounts.length === 1 ? accounts[0] : undefined;
};

/** The 90-day query guarantees complete data for the current and previous month. */
export const isCalendarMonthAvailable = (month: dayjs.Dayjs, now: number) => {
  const current = dayjs(now).startOf('month');
  return month.isSame(current, 'month') || month.isSame(current.subtract(1, 'month'), 'month');
};

const isSessionReading = (reading: QuotaLimitReading) =>
  reading.limitType === 'session' || reading.limitType === 'five_hour';

/** Does this reading belong to the series a view is showing? */
export const matchesSeries = (reading: QuotaLimitReading, series: QuotaSeriesKey) =>
  series.type === 'session'
    ? isSessionReading(reading)
    : reading.limitType.startsWith('weekly') && (reading.scopeKey || '') === series.scopeKey;

const sortByCapturedAt = (readings: QuotaLimitReading[]) =>
  [...readings].sort((a, b) => a.capturedAt - b.capturedAt);

const sameWindow = (a: QuotaLimitReading, b: QuotaLimitReading) =>
  a.resetsAt != null && b.resetsAt != null
    ? Math.abs(a.resetsAt - b.resetsAt) < RESET_MATCH_TOLERANCE_MS
    : b.utilization >= a.utilization;

/**
 * Tokens and cost burned per local day, from the usage ledger. This is what the
 * calendar shows: how much was actually spent on a day, not how fast quota was
 * being consumed relative to a window.
 */
export const buildDailySpend = (turns: UsageTurn[]): Map<string, DaySpend> => {
  const byDay = new Map<string, DaySpend>();

  for (const turn of turns) {
    const key = dayKeyOf(turn.occurredAt);
    const day = byDay.get(key) ?? { cost: 0, hasUnpricedTurn: false, tokens: 0 };

    day.tokens += turn.tokens;
    if (turn.cost == null) day.hasUnpricedTurn = true;
    else day.cost += turn.cost;

    byDay.set(key, day);
  }

  return byDay;
};

/**
 * Percentage points of a window burned per local day, from consecutive snapshot
 * deltas. No longer what the calendar cells show — it drives the heat shading,
 * which still has to answer "how hard did this day lean on the quota".
 *
 * A rollover between two samples restarts the meter, so the new sample's
 * utilization *is* the burn since reset. Negative deltas inside one window (a
 * provider correction) count as zero rather than negative burn.
 */
export const buildDailyBurn = (
  readings: QuotaLimitReading[],
  series: QuotaSeriesKey,
): Map<string, number> => {
  const list = sortByCapturedAt(readings.filter((r) => matchesSeries(r, series)));
  const windowMs = windowMsOf(series);
  const burnByDay = new Map<string, number>();

  for (const [index, current] of list.entries()) {
    if (index === 0) continue;
    const previous = list[index - 1];
    // A gap longer than one full window can hide entire windows — attributing
    // its delta to one day would paint a false spike.
    if (current.capturedAt - previous.capturedAt > windowMs) continue;

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
 * Heat level for a day, ranked against the busiest day in view rather than
 * against a fixed pace target: the calendar's job is to show which days were
 * heavy relative to this user's own month, and an absolute threshold flagged
 * almost every working day at once.
 */
export const heatLevelOf = (value: number, max: number): 0 | 1 | 2 | 3 | 4 => {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
};

/**
 * Resolve calendar intensity per day without mixing incomparable units.
 * LobeHub-owned days rank by tokens; days without a ledger row fall back to
 * provider-reported quota burn and rank against the other burn-only days.
 */
export const buildDailyHeatLevels = (
  spendByDay: Map<string, DaySpend>,
  burnByDay: Map<string, number>,
): Map<string, 0 | 1 | 2 | 3 | 4> => {
  const tokenMax = Math.max(0, ...[...spendByDay.values()].map((spend) => spend.tokens));
  const externalBurn = [...burnByDay].filter(([key]) => (spendByDay.get(key)?.tokens ?? 0) === 0);
  const burnMax = Math.max(0, ...externalBurn.map(([, burn]) => burn));
  const levels = new Map<string, 0 | 1 | 2 | 3 | 4>();

  for (const [key, spend] of spendByDay) {
    if (spend.tokens > 0) levels.set(key, heatLevelOf(spend.tokens, tokenMax));
  }
  for (const [key, burn] of externalBurn) levels.set(key, heatLevelOf(burn, burnMax));

  return levels;
};

/** A rate-limit alarm owns the corner; otherwise positive heat gets a dot. */
export const shouldShowHeatDot = (level: 0 | 1 | 2 | 3 | 4, rateLimited: boolean) =>
  level > 0 && !rateLimited;

/** The window of this series that is live right now. */
export const currentWindow = (
  readings: QuotaLimitReading[],
  series: QuotaSeriesKey,
  now: number,
): QuotaWindowSpan | null => {
  let newest: QuotaLimitReading | null = null;
  for (const reading of readings) {
    if (!matchesSeries(reading, series)) continue;
    if (reading.resetsAt == null || reading.resetsAt <= now) continue;
    if (!newest || reading.capturedAt > newest.capturedAt) newest = reading;
  }
  if (!newest) return null;

  return {
    peakUtilization: newest.utilization,
    rateLimitedAt: null,
    resetsAt: newest.resetsAt!,
    windowStartAt: newest.resetsAt! - windowMsOf(series),
  };
};

/**
 * The burn-down polyline for one window: its snapshot readings in capture
 * order, anchored at (windowStart, 0) — a window is refilled by definition at
 * its start instant.
 */
export const buildBurnSeries = (
  readings: QuotaLimitReading[],
  series: QuotaSeriesKey,
  window: QuotaWindowSpan,
): BurnPoint[] => {
  const points = sortByCapturedAt(
    readings.filter(
      (r) =>
        matchesSeries(r, series) &&
        r.capturedAt >= window.windowStartAt &&
        r.capturedAt <= window.resetsAt &&
        (r.resetsAt == null || Math.abs(r.resetsAt - window.resetsAt) < RESET_MATCH_TOLERANCE_MS),
    ),
  ).map((r) => ({ time: r.capturedAt, utilization: Math.min(100, Math.max(0, r.utilization)) }));

  return [{ time: window.windowStartAt, utilization: 0 }, ...points];
};

/** Tokens and cost spent inside one concrete window. */
export const spendInWindow = (turns: UsageTurn[], window: QuotaWindowSpan): DaySpend =>
  turns
    .filter((t) => t.occurredAt >= window.windowStartAt && t.occurredAt <= window.resetsAt)
    .reduce<DaySpend>(
      (acc, turn) => ({
        cost: acc.cost + (turn.cost ?? 0),
        hasUnpricedTurn: acc.hasUnpricedTurn || turn.cost == null,
        tokens: acc.tokens + turn.tokens,
      }),
      { cost: 0, hasUnpricedTurn: false, tokens: 0 },
    );

export type BurnProjection =
  | { exhaustAt: number; kind: 'exhaust' }
  | { kind: 'exhausted' }
  | { kind: 'safe'; projectedEndUtilization: number };

/**
 * How far back "current pace" looks before falling back to the whole window.
 * Scaled to the window: a day of history is meaningless inside a 5-hour window.
 */
const paceLookbackMs = (window: QuotaWindowSpan) => (window.resetsAt - window.windowStartAt) / 5;

/**
 * Project where the current pace lands. The reference sample is the newest
 * point at least one lookback old (so an idle stretch flattens the pace instead
 * of the whole window's average hiding a hot streak), falling back to the
 * window anchor when the window is younger than that.
 */
export const projectBurnout = (points: BurnPoint[], window: QuotaWindowSpan): BurnProjection => {
  const last = points.at(-1);
  if (!last || points.length < 2) return { kind: 'safe', projectedEndUtilization: 0 };
  if (last.utilization >= 100) return { kind: 'exhausted' };

  const lookback = paceLookbackMs(window);
  let reference = points[0];
  for (const point of points) {
    if (point.time <= last.time - lookback) reference = point;
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

/**
 * One concrete window with what it cost. This is the middle zoom level of the
 * panel: the burn chart is one window in detail, the month grid is calendar
 * days, and this is the window itself as a countable unit — which is the unit
 * the provider actually enforces.
 */
export interface WindowStat extends QuotaWindowSpan {
  cost: number;
  hasUnpricedTurn: boolean;
  isLive: boolean;
  tokens: number;
}

const withSpend = (window: QuotaWindowSpan, turns: UsageTurn[], now: number): WindowStat => {
  const spend = spendInWindow(turns, window);

  return {
    ...window,
    cost: spend.cost,
    hasUnpricedTurn: spend.hasUnpricedTurn,
    isLive: window.resetsAt > now,
    tokens: spend.tokens,
  };
};

/**
 * Recent windows of one series, newest first, each with its spend. The live
 * window is merged in from the readings: it has no `agent_quota_windows` row
 * until it closes, and leaving "now" out of a window list is exactly the gap
 * that makes the list feel disconnected from the chart above it.
 */
export const buildWindowStats = (
  windows: QuotaWindowSpan[],
  live: QuotaWindowSpan | null,
  turns: UsageTurn[],
  now: number,
  limit = 8,
): WindowStat[] => {
  const merged: QuotaWindowSpan[] = [];
  for (const window of [...windows, ...(live ? [live] : [])].sort(
    (a, b) => a.resetsAt - b.resetsAt,
  )) {
    const existingIndex = merged.findIndex(
      (candidate) => Math.abs(candidate.resetsAt - window.resetsAt) < RESET_MATCH_TOLERANCE_MS,
    );
    if (existingIndex < 0) {
      merged.push(window);
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      peakUtilization: Math.max(existing.peakUtilization, window.peakUtilization),
      rateLimitedAt: existing.rateLimitedAt ?? window.rateLimitedAt,
      // Keep the widest observed boundary pair for spend attribution.
      resetsAt: Math.max(existing.resetsAt, window.resetsAt),
      windowStartAt: Math.min(existing.windowStartAt, window.windowStartAt),
    };
  }

  return merged
    .sort((a, b) => b.resetsAt - a.resetsAt)
    .slice(0, limit)
    .map((window) => withSpend(window, turns, now));
};

export interface SessionGridColumn {
  date: dayjs.Dayjs;
  key: string;
  /** Windows that started on this local day, earliest first. */
  slots: (WindowStat | null)[];
}

export interface SessionGrid {
  columns: SessionGridColumn[];
  rowCount: number;
}

/**
 * Session windows laid out as slot × weekday. A 5-hour window is a *slot in a
 * day*, not a day — so the natural shape is a grid whose columns are days and
 * whose rows are the successive windows within each day. Columns are the seven
 * days ending on `endDay`, which keeps this block navigation-free: it reads as
 * "the last week of working windows" beside the month grid's longer arc.
 */
export const buildSessionGrid = (
  stats: WindowStat[],
  endDay: dayjs.Dayjs,
  days = 7,
): SessionGrid => {
  const byDay = new Map<string, WindowStat[]>();
  for (const stat of stats) {
    const key = dayKeyOf(stat.windowStartAt);
    byDay.set(key, [...(byDay.get(key) ?? []), stat]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.windowStartAt - b.windowStartAt);

  const start = endDay.startOf('day').subtract(days - 1, 'day');
  const columns = Array.from({ length: days }, (_, index) => {
    const date = start.add(index, 'day');
    const key = date.format('YYYY-MM-DD');
    return { date, key, slots: byDay.get(key) ?? [] };
  });
  const rowCount = Math.max(1, ...columns.map((c) => c.slots.length));

  return {
    columns: columns.map((c) => ({
      ...c,
      slots: Array.from({ length: rowCount }, (_, row) => c.slots[row] ?? null),
    })),
    rowCount,
  };
};

/** Utilization ramp for a window cell — absolute, since 0–100 already means something. */
export const utilizationLevelOf = (utilization: number): 0 | 1 | 2 | 3 | 4 => {
  if (utilization <= 0) return 0;
  if (utilization < 25) return 1;
  if (utilization < 50) return 2;
  if (utilization < 80) return 3;
  return 4;
};

/** Semantic quota pressure: comfortable, nearly full, or exhausted. */
export const utilizationStatusOf = (utilization: number): 'error' | 'safe' | 'warning' => {
  if (utilization >= 100) return 'error';
  if (utilization >= 80) return 'warning';
  return 'safe';
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

/** Compact token count for a calendar cell: 1.3B / 585M / 340K / 820. */
export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000_000)
    return `${(tokens / 1_000_000_000).toFixed(tokens >= 10_000_000_000 ? 0 : 1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(Math.round(tokens));
};

/** Cost for a summary line: $12.40 / $0.83. */
export const formatCost = (cost: number): string => `$${cost.toFixed(cost >= 10 ? 0 : 2)}`;

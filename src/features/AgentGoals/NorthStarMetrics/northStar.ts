import {
  type GoalMetricComparison,
  type GoalMetricCriterion,
  type MetricActorType,
  type MetricPointSourceType,
  toMetricScale,
} from '@lobechat/types';

import type { MetricSeriesPoint, MetricSeriesWithPoints } from '@/services/metric';

/**
 * View model of one north-star card: a declared acceptance clause joined with
 * its measured series. Pure derivation — the server's gate (#19133) stays the
 * authority on pass/fail; this only renders the same arithmetic.
 */
export interface NorthStarCard {
  /** Latest observation, null when the clause was never measured. */
  current: number | null;
  key: string;
  label: string;
  /** When the latest observation landed; undefined when never measured. */
  latestAt?: Date;
  met: boolean;
  op: GoalMetricComparison;
  /** 0-100, baseline → target. 0 when unmeasured. */
  percent: number;
  /**
   * The latest observation is older than the staleness window. A tracking
   * surface is only as trustworthy as its data is fresh, so this renders as a
   * warning, not a detail.
   */
  stale: boolean;
  target: number;
  /** Ascending observation values for the sparkline, capped. */
  trend: number[];
  unit?: string | null;
}

/** Two days without a sample and the number on the card is a claim, not a fact. */
export const NORTH_STAR_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const SPARKLINE_POINT_CAP = 60;

const compare = (rawValue: number, op: GoalMetricComparison, rawTarget: number): boolean => {
  // Both operands at the persisted numeric(20, 6) scale — the server's gate
  // compares this way, and a raw-target comparison here could disagree with
  // it at rounding boundaries (`eq 0.1234567` never holding while the goal
  // already advanced).
  const value = toMetricScale(rawValue);
  const target = toMetricScale(rawTarget);
  switch (op) {
    case 'eq': {
      return value === target;
    }
    case 'gt': {
      return value > target;
    }
    case 'gte': {
      return value >= target;
    }
    case 'lt': {
      return value < target;
    }
    case 'lte': {
      return value <= target;
    }
  }
};

/**
 * Progress from the first observation (the baseline) toward the target,
 * normalized by the clause's own direction — a count-down clause ("112 issues
 * → 0") reads 67% at 37 exactly like a count-up one reads at 67% of the climb.
 * `eq` measures closing distance from where the series started.
 */
const progress = (
  op: GoalMetricComparison,
  baseline: number,
  current: number,
  target: number,
): number => {
  const span =
    op === 'eq'
      ? Math.abs(baseline - target)
      : op === 'lte' || op === 'lt'
        ? baseline - target
        : target - baseline;
  if (span <= 0) return compare(current, op, target) ? 100 : 0;
  const walked =
    op === 'eq'
      ? span - Math.abs(current - target)
      : op === 'lte' || op === 'lt'
        ? baseline - current
        : current - baseline;
  return Math.max(0, Math.min(100, (walked / span) * 100));
};

export const buildNorthStarCards = (
  criteria: GoalMetricCriterion[],
  series: MetricSeriesWithPoints[],
  now = Date.now(),
): NorthStarCard[] => {
  const byKey = new Map(series.map((item) => [item.key, item]));

  return criteria.map((criterion) => {
    const op = criterion.op ?? 'gte';
    const matched = byKey.get(criterion.key);
    const points = matched?.points ?? [];
    const latest = points.at(-1);
    // The true first observation, not the window's oldest: `points` is a
    // recent window, and rebasing on it would silently inflate or deflate
    // progress once history outgrows the window.
    const baseline = matched?.firstPoint?.value ?? points[0]?.value;

    const trendSource = points.map((point) => point.value);
    const step = Math.max(1, Math.ceil(trendSource.length / SPARKLINE_POINT_CAP));
    const trend = trendSource.filter(
      (_, index) => index % step === 0 || index === trendSource.length - 1,
    );

    return {
      current: latest?.value ?? null,
      key: criterion.key,
      label: criterion.title || matched?.title || criterion.key,
      latestAt: latest?.observedAt,
      met: latest != null && compare(latest.value, op, criterion.target),
      op,
      percent:
        latest == null || baseline == null
          ? 0
          : progress(op, baseline, latest.value, criterion.target),
      stale: latest != null && now - latest.observedAt.getTime() > NORTH_STAR_STALE_AFTER_MS,
      target: criterion.target,
      trend,
      unit: matched?.unit,
    };
  });
};

/** `6,234` — counts get grouping; fractional metrics keep their precision. */
export const formatMetricValue = (value: number | null): string => {
  if (value == null) return '—';
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return String(value);
};

/** A goal task, as the observation history needs it. */
export interface NorthStarTaskRef {
  id: string;
  resolvedAt: Date;
  title: string;
}

/** One observation in the detail panel's history, newest first. */
export interface NorthStarObservationRow {
  actorType?: MetricActorType;
  /** Change from the observation before it; null for the first one in the window. */
  delta: number | null;
  observedAt: Date;
  sourceType?: MetricPointSourceType;
  /**
   * Tasks that finished since the observation before this one — the work this
   * number is the first measurement after.
   */
  tasks: NorthStarTaskRef[];
  value: number;
}

export const buildObservationRows = (
  points: MetricSeriesPoint[],
  tasks: NorthStarTaskRef[] = [],
): NorthStarObservationRow[] =>
  points
    .map((point, index) => {
      const previous = points[index - 1]?.observedAt.getTime() ?? -Infinity;
      const at = point.observedAt.getTime();
      return {
        actorType: point.actorType,
        delta: index === 0 ? null : point.value - points[index - 1].value,
        observedAt: point.observedAt,
        sourceType: point.sourceType,
        tasks: tasks
          .filter((task) => {
            const resolved = task.resolvedAt.getTime();
            return resolved > previous && resolved <= at;
          })
          .sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime()),
        value: point.value,
      };
    })
    .reverse();

/**
 * Rows for the detail chart: the observed series plus the target as a flat
 * reference line, so the gap reads off the chart instead of the legend.
 */
export const buildNorthStarChartRows = (
  points: { observedAt: Date; value: number }[],
  target: number,
  formatTime: (date: Date) => string,
): { target: number; time: string; value: number }[] =>
  points.map((point) => ({ target, time: formatTime(point.observedAt), value: point.value }));

export type DeltaTone = 'bad' | 'good' | 'neutral';

/**
 * Whether one observation's change is progress, read by the clause's own
 * direction: on a lower-is-better clause (`lte` / `lt`) a drop is progress, and
 * on `eq` progress is closing the distance to the target from the value before.
 */
export const deltaTone = (
  op: GoalMetricComparison,
  value: number,
  delta: number,
  target: number,
): DeltaTone => {
  if (delta === 0) return 'neutral';
  if (op === 'eq') {
    const before = Math.abs(value - delta - target);
    const after = Math.abs(value - target);
    return after === before ? 'neutral' : after < before ? 'good' : 'bad';
  }
  const lowerIsBetter = op === 'lte' || op === 'lt';
  return delta < 0 === lowerIsBetter ? 'good' : 'bad';
};

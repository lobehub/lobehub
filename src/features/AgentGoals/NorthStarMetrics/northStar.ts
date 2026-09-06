import type { GoalMetricComparison, GoalMetricCriterion } from '@lobechat/types';

import type { MetricSeriesWithPoints } from '@/services/metric';

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

const compare = (value: number, op: GoalMetricComparison, target: number): boolean => {
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
    const baseline = points[0]?.value;

    const trendSource = points.map((point) => point.value);
    const step = Math.max(1, Math.ceil(trendSource.length / SPARKLINE_POINT_CAP));
    const trend = trendSource.filter(
      (_, index) => index % step === 0 || index === trendSource.length - 1,
    );

    return {
      current: latest?.value ?? null,
      key: criterion.key,
      label: matched?.title || criterion.key,
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

/** A slot with no samples charts as a gap; formatters must accept it. */
type ChartValue = number | null | undefined;

export const formatPercent = (value: ChartValue) =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`;

/** How loaded a machine is: green, yellow, then red. */
export type UsageLevel = 'normal' | 'high' | 'critical';

export interface UsageThresholds {
  critical: number;
  high: number;
}

/** CPU / memory / disk share: yellow from 80%, red from 95%. */
export const USAGE_THRESHOLDS: UsageThresholds = { critical: 95, high: 80 };

/**
 * Load average per core. macOS counts threads waiting on disk as well as
 * runnable ones, so a busy dev machine sits above 100% with CPU to spare:
 * yellow once threads outnumber cores, red only at twice the cores.
 */
export const LOAD_THRESHOLDS: UsageThresholds = { critical: 200, high: 100 };

export const usageLevel = (
  value: ChartValue,
  thresholds: UsageThresholds = USAGE_THRESHOLDS,
): UsageLevel | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value >= thresholds.critical) return 'critical';
  if (value >= thresholds.high) return 'high';
  return 'normal';
};

const LEVEL_RANK: Record<UsageLevel, number> = { critical: 2, high: 1, normal: 0 };

/** The hottest of several levels — a block is as hot as its hottest metric. */
export const peakUsageLevel = (...levels: (UsageLevel | undefined)[]): UsageLevel | undefined =>
  levels.reduce<UsageLevel | undefined>(
    (peak, level) => (level && (!peak || LEVEL_RANK[level] > LEVEL_RANK[peak]) ? level : peak),
    undefined,
  );

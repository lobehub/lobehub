/** A slot with no samples charts as a gap; formatters must accept it. */
type ChartValue = number | null | undefined;

export const formatPercent = (value: ChartValue) =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`;

/** How loaded a machine is: yellow from 70%, red from 90%. */
export type UsageLevel = 'normal' | 'high' | 'critical';

export const HIGH_USAGE_PERCENT = 70;
export const CRITICAL_USAGE_PERCENT = 90;

export const usageLevel = (value: ChartValue): UsageLevel | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value >= CRITICAL_USAGE_PERCENT) return 'critical';
  if (value >= HIGH_USAGE_PERCENT) return 'high';
  return 'normal';
};

/** The level of the busiest of several readings — a block is as hot as its hottest metric. */
export const peakUsageLevel = (...values: ChartValue[]): UsageLevel | undefined => {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  return present.length === 0 ? undefined : usageLevel(Math.max(...present));
};

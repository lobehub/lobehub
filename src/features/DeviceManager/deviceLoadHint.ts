import type { HealthUsage } from './DeviceHealth/buildHealthTimeline';
import { type UsageLevel, usageLevel } from './DeviceHealth/format';

/** Segments of the level meter, bottom to top; each stands for 20%. */
export const LOAD_HINT_SEGMENTS = 5;

export type LoadHintMetric = 'cpu' | 'memory' | 'load';

export interface LoadHint {
  /** Color of the lit segments: the level of the busiest reading. */
  level: UsageLevel;
  /** Lit segments from the bottom, 0 – {@link LOAD_HINT_SEGMENTS}. */
  lit: number;
  /** Every reading the device has, for the tooltip. */
  readings: { metric: LoadHintMetric; value: number }[];
}

/**
 * One meter for the whole machine: a run stalls on whichever of CPU, memory
 * or load is exhausted, so the meter shows the busiest of them, with the same
 * yellow / red thresholds as the device page. Load averages are absent on
 * Windows and are then simply not considered. Load above 100% of the cores
 * fills the meter; any non-zero reading lights the bottom segment, so a
 * running machine never reads as empty.
 */
export const loadHint = (usage: HealthUsage | null): LoadHint | null => {
  if (!usage) return null;
  const readings = (
    [
      ['cpu', usage.cpuPercent],
      ['memory', usage.memoryPercent],
      ['load', usage.loadPercent],
    ] as const
  )
    .filter((entry): entry is readonly [LoadHintMetric, number] => entry[1] !== null)
    .map(([metric, value]) => ({ metric, value }));
  if (readings.length === 0) return null;

  const peak = Math.max(...readings.map((r) => r.value));
  const lit =
    peak <= 0
      ? 0
      : Math.min(LOAD_HINT_SEGMENTS, Math.max(1, Math.ceil((peak / 100) * LOAD_HINT_SEGMENTS)));

  return { level: usageLevel(peak) ?? 'normal', lit, readings };
};

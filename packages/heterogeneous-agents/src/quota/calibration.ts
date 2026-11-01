import type { QuotaCalibrationResult, QuotaWindowProjection } from './types';

/** Median of a numeric array (unsorted input ok). Returns 0 for empty. */
export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

/**
 * Theil–Sen slope estimator: the median of pairwise slopes. Robust to the
 * outliers that plague quota data (a window cut short by the weekly limit, a
 * partially-imported window). Returns null when fewer than two distinct points.
 */
export const theilSenSlope = (points: { x: number; y: number }[]): number | null => {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[j].x - points[i].x;
      if (dx === 0) continue;
      slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  return slopes.length === 0 ? null : median(slopes);
};

/** One clean interval between two snapshots: how much the meter and $ moved. */
export interface CalibrationInterval {
  deltaCostUsd: number;
  deltaUtil: number;
}

/** Enough windows/samples that a calibration is worth trusting at all. */
export const MIN_CALIBRATION_SAMPLES = 3;

/**
 * Turn projected windows into calibration samples. A window starts empty (0%),
 * so its whole-window `peakUtilization` and `observedCostUsd` are one
 * (Δutil, Δcost) point. Windows unfit for calibration are dropped:
 *  - `contaminated`: the meter moved on usage we didn't record → cost too low.
 *  - `rateLimitedAt`: censored — a higher-tier (weekly) limit cut it short, so
 *    100% was reached without us spending a matching amount.
 */
export const windowsToCalibrationIntervals = (
  windows: (Pick<QuotaWindowProjection, 'peakUtilization' | 'rateLimitedAt'> & {
    contaminated?: boolean;
    observedCostUsd?: number | null;
  })[],
): CalibrationInterval[] =>
  windows
    .filter(
      (w) =>
        !w.contaminated &&
        w.rateLimitedAt == null &&
        w.peakUtilization > 0 &&
        w.peakUtilization < 100 &&
        (w.observedCostUsd ?? 0) > 0,
    )
    .map((w) => ({ deltaCostUsd: w.observedCostUsd as number, deltaUtil: w.peakUtilization }));

export interface CalibrateOptions {
  /** Smoothing constant for the confidence curve. */
  confidenceK?: number;
  /** Minimum utilization movement (percentage points) for a usable sample. */
  minDeltaUtil?: number;
}

/**
 * Solve capacity (in USD) from clean Δutilization ↔ Δcost intervals.
 *
 * Each interval gives `$ per percentage point`; capacity = median of those × 100.
 * Utilization is an integer percent, so a Δ of 1 carries ~100% quantization
 * error — intervals below `minDeltaUtil` are dropped. The median (rather than a
 * mean or single ratio) keeps the estimate robust to windows a higher-tier
 * limit cut short.
 */
export const calibrateCapacity = (
  intervals: CalibrationInterval[],
  options: CalibrateOptions = {},
): QuotaCalibrationResult | null => {
  const minDeltaUtil = options.minDeltaUtil ?? 5;
  const confidenceK = options.confidenceK ?? 5;

  const usable = intervals.filter((i) => i.deltaUtil >= minDeltaUtil && i.deltaCostUsd > 0);
  if (usable.length === 0) return null;

  const slopes = usable.map((i) => i.deltaCostUsd / i.deltaUtil);
  const perPoint = median(slopes);
  const capacityUsd = perPoint * 100;

  // dispersion → confidence: tight agreement across samples raises confidence,
  // more samples raise it, both saturating toward 1.
  const mean = slopes.reduce((a, b) => a + b, 0) / slopes.length;
  const variance = slopes.reduce((a, b) => a + (b - mean) ** 2, 0) / slopes.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const sampleFactor = usable.length / (usable.length + confidenceK);
  const dispersionFactor = 1 / (1 + cv);
  const confidence = Math.max(0, Math.min(1, sampleFactor * dispersionFactor));

  return {
    capacityUsd,
    confidence,
    method: 'ratio-median',
    sampleCount: usable.length,
  };
};

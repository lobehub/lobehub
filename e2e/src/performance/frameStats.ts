/** A frame gap above this is a visible stall (three missed 60 Hz frames). */
export const LONG_FRAME_MS = 50;

export interface FrameStats {
  /** Frames sampled during the window. */
  frames: number;
  /** Frame gaps above {@link LONG_FRAME_MS}. */
  longFrames: number;
  /** Largest gap between two consecutive animation frames. */
  maxGapMs: number;
  /** 95th percentile gap between consecutive animation frames. */
  p95GapMs: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Summarize `requestAnimationFrame` timestamps collected in the page. */
export const summarizeFrames = (timestamps: number[]): FrameStats => {
  const gaps = timestamps.slice(1).map((value, i) => value - timestamps[i]);
  if (gaps.length === 0)
    return { frames: timestamps.length, longFrames: 0, maxGapMs: 0, p95GapMs: 0 };

  const sorted = [...gaps].sort((a, b) => a - b);
  // Nearest-rank percentile: the smallest gap at or above 95% of the samples.
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];

  return {
    frames: timestamps.length,
    longFrames: gaps.filter((gap) => gap > LONG_FRAME_MS).length,
    maxGapMs: round(sorted.at(-1)!),
    p95GapMs: round(p95),
  };
};

interface ExpertiseSeriesPoint {
  n: number;
  run: number;
}

/** Recent net growth, using zero as the baseline for a domain's first practice. */
export const recentLessonDelta = (points: ExpertiseSeriesPoint[]) => {
  const recent = points.slice(-6);
  if (recent.length === 0) return 0;
  if (recent.length === 1) return recent[0].n;
  return recent.at(-1)!.n - recent[0].n;
};

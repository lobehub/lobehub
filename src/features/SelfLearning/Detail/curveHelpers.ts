interface LearnedSnapshot {
  learnedTotal: number;
}

/** Returns newly learned lessons per run without treating retirements as negative learning. */
export const getLearnedGains = (series: LearnedSnapshot[]) =>
  series.map((snapshot, index) =>
    Math.max(0, snapshot.learnedTotal - (series[index - 1]?.learnedTotal ?? 0)),
  );

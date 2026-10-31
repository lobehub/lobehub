interface OverviewRun {
  hasUnverifiedAttempts?: boolean;
  metrics?: Record<string, unknown> | null;
  status?: string | null;
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

/** Metrics count cases, including pass@k cases, never individual K attempts. */
export const runGradingGap = (run: OverviewRun) => {
  const metrics = run.metrics ?? {};
  const judgeErrors = count(metrics.judgeErrorCases);
  const external = count(metrics.externalCases);
  const accounted = ['passedCases', 'failedCases', 'errorCases', 'timeoutCases'].reduce(
    (sum, key) => sum + count(metrics[key]),
    judgeErrors + external,
  );
  return {
    external,
    judgeErrors,
    unaccounted: Math.max(0, count(metrics.totalCases) - accounted),
  };
};

export const isRunGradingComplete = (run: OverviewRun) => {
  const { external, judgeErrors, unaccounted } = runGradingGap(run);
  return (
    run.status === 'completed' &&
    !run.hasUnverifiedAttempts &&
    count(run.metrics?.errorCases) === 0 &&
    count(run.metrics?.timeoutCases) === 0 &&
    external === 0 &&
    judgeErrors === 0 &&
    unaccounted === 0
  );
};

export const isExperimentGradingComplete = (runs: OverviewRun[]) =>
  runs.length > 0 && runs.every(isRunGradingComplete);

export const experimentCaseProgress = (runs: OverviewRun[]) =>
  runs.reduce(
    (progress, run) => ({
      done:
        progress.done +
        (typeof run.metrics?.completedCases === 'number' &&
        Number.isFinite(run.metrics.completedCases)
          ? count(run.metrics.completedCases)
          : Math.max(0, count(run.metrics?.totalCases) - runGradingGap(run).unaccounted)),
      total: progress.total + count(run.metrics?.totalCases),
    }),
    { done: 0, total: 0 },
  );

/** Keep candidate failures and Judge recovery separate; running work is not a historical gap. */
export const overviewAttention = (runs: OverviewRun[]) =>
  runs.reduce(
    (attention, run) => {
      const gap = runGradingGap(run);
      return {
        errors: attention.errors + count(run.metrics?.errorCases),
        external: attention.external + gap.external,
        judgeErrors: attention.judgeErrors + gap.judgeErrors,
        unaccounted:
          attention.unaccounted +
          (['pending', 'running'].includes(run.status ?? '') ? 0 : gap.unaccounted),
      };
    },
    { errors: 0, external: 0, judgeErrors: 0, unaccounted: 0 },
  );

import type { AgentEvalRunListItem } from '@lobechat/types';

import { getRunModel } from '@/features/Eval/Benchmark/RunsTab/runModel';

export interface RunModelRef {
  model: string;
  provider?: string;
}

export const isComparisonRun = (run: Pick<AgentEvalRunListItem, 'config'>) =>
  run.config?.executionMode === 'replay';

/** Newest first — the server already orders, but merged/optimistic rows may not be. */
export const sortRunsNewestFirst = <T extends Pick<AgentEvalRunListItem, 'createdAt'>>(
  runs: T[],
): T[] =>
  [...runs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

/** Models a run evaluated: every replay target for a comparison, else the run's one model. */
export const getRunModels = (run: AgentEvalRunListItem): RunModelRef[] => {
  if (isComparisonRun(run)) {
    return (run.config?.replayTargets ?? []).map((target) => ({
      model: target.model,
      provider: target.provider,
    }));
  }
  const model = getRunModel(run);
  return model ? [model] : [];
};

/**
 * A run's pass rate, or `undefined` when it has none to report. A run where
 * every case errored never judged anything — showing 0% would blame the model
 * for what is a harness failure, so it reads as no rate (its status says why).
 */
export const getRunPassRate = (run: AgentEvalRunListItem): number | undefined => {
  const metrics = run.metrics;
  if (metrics && metrics.totalCases > 0 && (metrics.errorCases ?? 0) >= metrics.totalCases) {
    return undefined;
  }
  const rate = run.metrics?.passRate ?? run.passRate;
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : undefined;
};

/**
 * Where a run lives. Comparisons have their own page; a regular run lives under
 * its dataset's benchmark. Runs carry no benchmark id, so it is resolved from
 * the dataset list — a run whose benchmark is unknown falls back to its dataset.
 */
export const getRunHref = (
  run: Pick<AgentEvalRunListItem, 'config' | 'datasetId' | 'id'>,
  benchmarkIdByDataset: Map<string, string | null | undefined>,
): string => {
  if (isComparisonRun(run)) return `/eval/comparisons/${run.id}`;
  const benchmarkId = benchmarkIdByDataset.get(run.datasetId);
  if (benchmarkId) return `/eval/bench/${benchmarkId}/runs/${run.id}`;
  return `/eval/datasets/${run.datasetId}`;
};

/**
 * Pass rate across the recent runs that finished with a rate, weighted by case
 * count so one 2-case run cannot swing the figure. `undefined` when no run has
 * finished — the overview then hides the tile rather than showing a fake 0%.
 */
export const getRecentPassRate = (
  runs: AgentEvalRunListItem[],
): { rate: number; runCount: number } | undefined => {
  let passed = 0;
  let total = 0;
  let runCount = 0;

  for (const run of runs) {
    if (run.status !== 'completed') continue;
    const rate = getRunPassRate(run);
    if (rate === undefined) continue;
    const cases = run.metrics?.totalCases ?? run.totalCases ?? 0;
    const weight = cases > 0 ? cases : 1;
    passed += rate * weight;
    total += weight;
    runCount += 1;
  }

  if (runCount === 0 || total === 0) return undefined;
  return { rate: passed / total, runCount };
};

'use client';

import type { AgentEvalDatasetListItem, AgentEvalExperimentDetail } from '@lobechat/types';
import { useMemo } from 'react';

import { createRunCreateModal } from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunCreateModal';

/**
 * Shared derivations + mutations for the experiment workspace. The single
 * experiment-detail payload is split into baseline vs scoped datasets here,
 * and "Add Run" opens the shared RunCreateModal (which revalidates the
 * experiment detail itself via the experimentId passthrough).
 */
export const useExperimentActions = (experiment?: AgentEvalExperimentDetail) => {
  const experimentId = experiment?.id;

  /** Baseline (non-scoped) datasets across the linked benchmarks. */
  const baselineDatasets = useMemo<AgentEvalDatasetListItem[]>(
    () =>
      (experiment?.datasets || []).filter((dataset) => dataset.sourceExperimentId !== experimentId),
    [experiment, experimentId],
  );

  /** Experiment-scoped subsets / forks. */
  const scopedDatasets = useMemo<AgentEvalDatasetListItem[]>(
    () =>
      (experiment?.datasets || []).filter((dataset) => dataset.sourceExperimentId === experimentId),
    [experiment, experimentId],
  );

  const datasetBenchmarkMap = useMemo(
    () => new Map((experiment?.datasets || []).map((dataset) => [dataset.id, dataset.benchmarkId])),
    [experiment],
  );

  const addRun = (dataset: AgentEvalDatasetListItem) => {
    if (!experimentId) return;
    createRunCreateModal({
      benchmarkId: dataset.benchmarkId,
      datasetId: dataset.id,
      datasetName: dataset.name,
      experimentId,
    });
  };

  /** Resolve the benchmark a run belongs to (experiments span benchmarks). */
  const resolveRunBenchmarkId = (run: { datasetId: string }) =>
    datasetBenchmarkMap.get(run.datasetId) || experiment?.benchmarks[0]?.id || '';

  return { addRun, baselineDatasets, resolveRunBenchmarkId, scopedDatasets };
};

import { useCallback } from 'react';

import { newExperimentPath } from '@/features/LobeBench/experimentNavigation';
import { useIsLobeBenchBenchmark } from '@/features/LobeBench/useIsLobeBenchBenchmark';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { datasetSelectors, useEvalStore } from '@/store/eval';

import { createRunCreateModal } from './index';

/**
 * The "new run" action of a benchmark page. A Lab benchmark opens the run
 * modal; a Lobe Bench benchmark, whose runs also open on these Lab pages,
 * goes to Lobe Bench's new experiment page instead, so its experiments start
 * in one place, with contenders and the benchmark's standard.
 */
export const useCreateRun = (benchmarkId?: string) => {
  const navigate = useWorkspaceAwareNavigate();
  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);
  // The dataset page can open before the benchmark list: load the benchmark to know its side.
  useFetchBenchmarkDetail(benchmarkId);
  const lobeBench = useIsLobeBenchBenchmark(benchmarkId);
  const firstDatasetId = useEvalStore((s) => datasetSelectors.datasetList(benchmarkId)(s)[0]?.id);

  const createRun = useCallback(
    (dataset?: { id: string; name?: string }) => {
      if (!benchmarkId) return;
      if (lobeBench) {
        navigate(newExperimentPath(dataset?.id ?? firstDatasetId));
        return;
      }
      createRunCreateModal({ benchmarkId, datasetId: dataset?.id, datasetName: dataset?.name });
    },
    [benchmarkId, firstDatasetId, lobeBench, navigate],
  );

  return { createRun, lobeBench };
};

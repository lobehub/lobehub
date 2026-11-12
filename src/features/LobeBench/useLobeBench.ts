import type { AgentEvalExperimentListItem } from '@lobechat/types';
import { useMemo } from 'react';

import { isLobeBenchBenchmark, isLobeBenchMeta } from '@/features/LobeBench/lobeBench';
import { useEvalStore } from '@/store/eval';
import type { LobeBenchCase } from '@/store/eval/slices/lobeBench/projection';

interface PollConfig {
  refreshInterval?: number;
}

/** Benchmarks flagged `metadata.kind = 'lobe-bench'` (usually one). */
export const useLobeBenchBenchmarks = () => {
  const benchmarkList = useEvalStore((s) => s.benchmarkList);
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const swr = useFetchBenchmarks();
  const benchmarks = useMemo(() => benchmarkList.filter(isLobeBenchBenchmark), [benchmarkList]);
  return { ...swr, benchmarks };
};

/** Experiments created by Lobe Bench, newest first. */
export const useLobeBenchExperiments = () => {
  const experimentList = useEvalStore((s) => s.experimentList);
  const isInit = useEvalStore((s) => s.experimentListInit);
  const useFetchExperiments = useEvalStore((s) => s.useFetchExperiments);
  const swr = useFetchExperiments();
  const experiments = useMemo(
    () =>
      (experimentList as AgentEvalExperimentListItem[])
        .filter((experiment) => isLobeBenchMeta(experiment.metadata))
        .sort(
          (a, b) =>
            new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
            new Date(a.updatedAt ?? a.createdAt ?? 0).getTime(),
        ),
    [experimentList],
  );
  return { ...swr, experiments, isInit };
};

/** The case set an overview talks about and a new experiment starts from. */
export { pickDefaultDataset } from '@/features/LobeBench/lobeBench';

/** Case sets of the Lobe Bench benchmarks, plus the standalone imported ones. */
export const useLobeBenchDatasets = (benchmarkIds: string[]) =>
  useEvalStore.getState().useFetchLobeBenchDatasets(benchmarkIds);

/** Every run under the Lobe Bench benchmarks, newest first. */
export const useLobeBenchRuns = (benchmarkIds: string[], config?: PollConfig) =>
  useEvalStore.getState().useFetchLobeBenchRuns(benchmarkIds, config);

/** The runs of one experiment (one per contender). */
export const useExperimentRuns = (experimentId: string | undefined, config?: PollConfig) =>
  useEvalStore.getState().useFetchExperimentRuns(experimentId, config);

/** Per-case results of several runs, keyed by run id. */
export const useRunResultsMap = (runIds: string[], config?: PollConfig) =>
  useEvalStore.getState().useFetchRunResultsByRun(runIds, config);

export { fetchDatasetCases } from '@/store/eval/slices/lobeBench/fetchers';
export type { LobeBenchCase } from '@/store/eval/slices/lobeBench/projection';

/** The environment fields a case carries itself (not those of its shared environment). */
export const ownEnvironmentOf = (testCase: LobeBenchCase): Record<string, any> | undefined =>
  testCase.environment ? (testCase.environmentOverrides ?? {}) : testCase.content?.environment;

/** All cases of a dataset, in benchmark order. */
export const useDatasetCases = (datasetId: string | undefined) =>
  useEvalStore.getState().useFetchDatasetCases(datasetId);

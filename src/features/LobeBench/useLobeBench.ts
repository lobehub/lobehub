import type {
  AgentEvalDatasetListItem,
  AgentEvalExperimentListItem,
  AgentEvalRunListItem,
  AgentEvalRunTopicResult,
} from '@lobechat/types';
import { useMemo } from 'react';

import { isLobeBenchBenchmark, isLobeBenchMeta, unwrapList } from '@/features/LobeBench/lobeBench';
import { useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

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

/** Case sets of the Lobe Bench benchmarks. */
export const useLobeBenchDatasets = (benchmarkIds: string[]) =>
  useClientDataSWR<AgentEvalDatasetListItem[]>(
    benchmarkIds.length > 0 ? ['lobe-bench/datasets', ...benchmarkIds] : null,
    async () => {
      const lists = await Promise.all(benchmarkIds.map((id) => agentEvalService.listDatasets(id)));
      return lists
        .flatMap((list) => unwrapList<AgentEvalDatasetListItem>(list))
        .sort(
          (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
        );
    },
  );

/** Every run under the Lobe Bench benchmarks, newest first. */
export const useLobeBenchRuns = (benchmarkIds: string[], config?: PollConfig) =>
  useClientDataSWR<AgentEvalRunListItem[]>(
    benchmarkIds.length > 0 ? ['lobe-bench/runs', ...benchmarkIds] : null,
    async () => {
      const lists = await Promise.all(
        benchmarkIds.map((benchmarkId) => agentEvalService.listRuns({ benchmarkId })),
      );
      return lists
        .flatMap((list) => unwrapList<AgentEvalRunListItem>(list))
        .sort(
          (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
        );
    },
    config,
  );

/** The runs of one experiment (one per contender). */
export const useExperimentRuns = (experimentId: string | undefined, config?: PollConfig) =>
  useClientDataSWR<AgentEvalRunListItem[]>(
    experimentId ? ['lobe-bench/experiment-runs', experimentId] : null,
    async () => unwrapList<AgentEvalRunListItem>(await agentEvalService.listRuns({ experimentId })),
    config,
  );

/** Per-case results of several runs, keyed by run id. */
export const useRunResultsMap = (runIds: string[], config?: PollConfig) =>
  useClientDataSWR<Record<string, AgentEvalRunTopicResult[]>>(
    runIds.length > 0 ? ['lobe-bench/run-results', ...runIds] : null,
    async () => {
      const entries = await Promise.all(
        runIds.map(async (runId) => {
          const response = (await agentEvalService.getRunResults(runId)) as {
            data?: { results?: AgentEvalRunTopicResult[] };
            results?: AgentEvalRunTopicResult[];
          };
          return [runId, response?.results ?? response?.data?.results ?? []] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    config,
  );

export interface LobeBenchCase {
  content?: Record<string, any> | null;
  /** The shared environment the case runs in, when it has one. */
  environment?: { id: string; name: string } | null;
  environmentId?: string | null;
  /** The case's own environment fields, laid over the shared environment (present with one). */
  environmentOverrides?: Record<string, any>;
  evalConfig?: Record<string, any> | null;
  evalMode?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  sortOrder?: number | null;
}

/** The environment fields a case carries itself (not those of its shared environment). */
export const ownEnvironmentOf = (testCase: LobeBenchCase): Record<string, any> | undefined =>
  testCase.environment ? (testCase.environmentOverrides ?? {}) : testCase.content?.environment;

const PAGE = 100;

/** All cases of a dataset, in benchmark order. */
export const fetchDatasetCases = async (datasetId: string) => {
  const cases: LobeBenchCase[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = (await agentEvalService.listTestCases({
      datasetId,
      limit: PAGE,
      offset,
    })) as { data?: LobeBenchCase[]; total?: number };
    const page = response?.data ?? [];
    cases.push(...page);
    if (page.length < PAGE || cases.length >= (response?.total ?? cases.length)) break;
  }
  return cases;
};

/** All cases of a dataset, in benchmark order. */
export const useDatasetCases = (datasetId: string | undefined) =>
  useClientDataSWR<LobeBenchCase[]>(datasetId ? ['lobe-bench/cases', datasetId] : null, () =>
    fetchDatasetCases(datasetId!),
  );

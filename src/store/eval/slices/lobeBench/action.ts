import type { AgentEvalDatasetListItem, AgentEvalRunListItem } from '@lobechat/types';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import { type ReplicaQueryResult, toReplicaQueryResult } from '@/store/eval/replicaQuery';
import { type EvalStore, useEvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  fetchCasesByDataset,
  fetchDatasetCases,
  fetchLobeBenchDatasets,
  fetchLobeBenchRuns,
  fetchRunResultsByRun,
} from './fetchers';
import {
  type CasesByDataset,
  casesByDatasetResource,
  datasetCaseListResource,
  ENVIRONMENT_LIST_KEY,
  ENVIRONMENT_LIST_PARAMS,
  environmentListResource,
  type EvalEnvironmentRow,
  experimentRunListResource,
  idSetKey,
  type LobeBenchCase,
  lobeBenchDatasetListResource,
  lobeBenchRunListResource,
  type RunResultsByRun,
  runResultsByRunResource,
} from './projection';

const n = setNamespace('evalLobeBench');

type Setter = StoreSetter<EvalStore>;

/** Only the scheduling knob callers pass today; `useSync` accepts the full schedule. */
type PollConfig = { refreshInterval?: number };

export const createLobeBenchSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new LobeBenchActionImpl(set, get, _api);

/**
 * The Lobe Bench pages' server data. Each list is a replica owning one map of
 * the store; the hooks keep the `{ data, error, isLoading, mutate }` shape.
 */
export class LobeBenchActionImpl {
  readonly #casesByDataset;
  readonly #datasetCases;
  readonly #datasets;
  readonly #environments;
  readonly #experimentRuns;
  readonly #runResults;
  readonly #runs;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;

    this.#datasets = createReplicaSlice(lobeBenchDatasetListResource, {
      actionPrefix: n('datasets'),
      fetcher: ({ benchmarkIds }) => fetchLobeBenchDatasets(benchmarkIds),
      get,
      set,
      stateKey: 'lobeBenchDatasetListReplica',
      view: recordLens<EvalStore, AgentEvalDatasetListItem[]>('lobeBenchDatasetListMap'),
    });
    this.#runs = createReplicaSlice(lobeBenchRunListResource, {
      actionPrefix: n('runs'),
      fetcher: ({ benchmarkIds }) => fetchLobeBenchRuns(benchmarkIds),
      get,
      set,
      stateKey: 'lobeBenchRunListReplica',
      view: recordLens<EvalStore, AgentEvalRunListItem[]>('lobeBenchRunListMap'),
    });
    this.#experimentRuns = createReplicaSlice(experimentRunListResource, {
      actionPrefix: n('experimentRuns'),
      fetcher: (experimentId) => agentEvalService.listAllRuns({ experimentId }),
      get,
      set,
      stateKey: 'experimentRunListReplica',
      view: recordLens<EvalStore, AgentEvalRunListItem[]>('experimentRunListMap'),
    });
    this.#runResults = createReplicaSlice(runResultsByRunResource, {
      actionPrefix: n('runResults'),
      fetcher: fetchRunResultsByRun,
      get,
      set,
      stateKey: 'runResultsByRunReplica',
      view: recordLens<EvalStore, RunResultsByRun>('runResultsByRunMap'),
    });
    this.#datasetCases = createReplicaSlice(datasetCaseListResource, {
      actionPrefix: n('datasetCases'),
      fetcher: fetchDatasetCases,
      get,
      set,
      stateKey: 'datasetCaseListReplica',
      view: recordLens<EvalStore, LobeBenchCase[]>('datasetCaseListMap'),
    });
    this.#casesByDataset = createReplicaSlice(casesByDatasetResource, {
      actionPrefix: n('casesByDataset'),
      fetcher: fetchCasesByDataset,
      get,
      set,
      stateKey: 'casesByDatasetReplica',
      view: recordLens<EvalStore, CasesByDataset>('casesByDatasetMap'),
    });
    this.#environments = createReplicaSlice(environmentListResource, {
      actionPrefix: n('environments'),
      fetcher: async () => (await agentEvalService.listEnvironments()) as EvalEnvironmentRow[],
      get,
      set,
      stateKey: 'environmentListReplica',
      view: recordLens<EvalStore, EvalEnvironmentRow[]>('environmentListMap'),
    });
  }

  /** Revalidates every mounted Lobe Bench dataset list (sidebar, pickers, pages). */
  refreshLobeBenchDatasets = async (): Promise<void> => {
    await this.#datasets.revalidate();
  };

  /** Re-reads the cases of a dataset, mounted or not. */
  refreshDatasetCases = async (datasetId: string): Promise<void> => {
    await this.#datasetCases.fetch(datasetId, { fresh: true });
  };

  /** Case sets of the given Lobe Bench benchmarks plus the standalone imported ones. */
  useFetchLobeBenchDatasets = (
    benchmarkIds: string[],
  ): ReplicaQueryResult<AgentEvalDatasetListItem[]> => {
    const data = useEvalStore((s) => s.lobeBenchDatasetListMap[idSetKey(benchmarkIds)]);
    const sync = this.#datasets.useSync({ benchmarkIds });
    return toReplicaQueryResult(sync, data, true);
  };

  /** Every run under the given Lobe Bench benchmarks, newest first. */
  useFetchLobeBenchRuns = (
    benchmarkIds: string[],
    config?: PollConfig,
  ): ReplicaQueryResult<AgentEvalRunListItem[]> => {
    const active = benchmarkIds.length > 0;
    const data = useEvalStore((s) =>
      active ? s.lobeBenchRunListMap[idSetKey(benchmarkIds)] : undefined,
    );
    const sync = this.#runs.useSync(active ? { benchmarkIds } : null, config);
    return toReplicaQueryResult(sync, data, active);
  };

  /** The runs of one experiment (one per contender). */
  useFetchExperimentRuns = (
    experimentId: string | undefined,
    config?: PollConfig,
  ): ReplicaQueryResult<AgentEvalRunListItem[]> => {
    const data = useEvalStore((s) =>
      experimentId ? s.experimentRunListMap[experimentId] : undefined,
    );
    const sync = this.#experimentRuns.useSync(experimentId ?? null, config);
    return toReplicaQueryResult(sync, data, !!experimentId);
  };

  /** Per-case results of several runs, keyed by run id. */
  useFetchRunResultsByRun = (
    runIds: string[],
    config?: PollConfig,
  ): ReplicaQueryResult<RunResultsByRun> => {
    const active = runIds.length > 0;
    const data = useEvalStore((s) => (active ? s.runResultsByRunMap[idSetKey(runIds)] : undefined));
    const sync = this.#runResults.useSync(active ? runIds : null, config);
    return toReplicaQueryResult(sync, data, active);
  };

  /** All cases of a dataset, in benchmark order. */
  useFetchDatasetCases = (datasetId: string | undefined): ReplicaQueryResult<LobeBenchCase[]> => {
    const data = useEvalStore((s) => (datasetId ? s.datasetCaseListMap[datasetId] : undefined));
    const sync = this.#datasetCases.useSync(datasetId ?? null);
    return toReplicaQueryResult(sync, data, !!datasetId);
  };

  /** All cases of several datasets, keyed by dataset id. */
  useFetchCasesByDataset = (datasetIds: string[]): ReplicaQueryResult<CasesByDataset> => {
    const active = datasetIds.length > 0;
    const data = useEvalStore((s) =>
      active ? s.casesByDatasetMap[idSetKey(datasetIds)] : undefined,
    );
    const sync = this.#casesByDataset.useSync(active ? datasetIds : null);
    return toReplicaQueryResult(sync, data, active);
  };

  /** Reusable case environments of the active scope. */
  useFetchEvalEnvironments = (): ReplicaQueryResult<EvalEnvironmentRow[]> => {
    const data = useEvalStore((s) => s.environmentListMap[ENVIRONMENT_LIST_KEY]);
    const sync = this.#environments.useSync(ENVIRONMENT_LIST_PARAMS);
    return toReplicaQueryResult(sync, data, true);
  };
}

export type LobeBenchAction = Pick<LobeBenchActionImpl, keyof LobeBenchActionImpl>;

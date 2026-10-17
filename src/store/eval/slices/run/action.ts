import type {
  AgentEvalRunDetail,
  AgentEvalRunListItem,
  AgentEvalRunResults,
  EvalRunInputConfig,
} from '@lobechat/types';

import {
  arrayEntity,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  benchmarkRunListResource,
  datasetRunListResource,
  runDetailResource,
  runResultsResource,
} from './projection';

const n = setNamespace('evalRun');

type Setter = StoreSetter<EvalStore>;

/** Only the scheduling knob callers pass today; `useSync` accepts the full schedule. */
type FetchConfig = { refreshInterval?: number };

export const createRunSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new RunActionImpl(set, get, _api);

export class RunActionImpl {
  readonly #get: () => EvalStore;
  readonly #set: Setter;

  /**
   * Four local-first resources over the run entity, each owning ONE store
   * location (selectors keep reading those maps):
   * - `#benchmarkRunList`: sidebar + RunsTab → `runListMap[benchmarkId]`
   * - `#datasetRunList`: dataset page → `datasetRunListMap[datasetId]`
   * - `#runDetail`: by-id detail → `runDetailMap[runId]`
   * - `#runResults`: by-id case results → `runResultsMap[runId]`
   * `#runEntity` fans a run-level change (delete / update) out to whichever
   * list and detail currently hold that run.
   */
  readonly #benchmarkRunList;
  readonly #datasetRunList;
  readonly #runDetail;
  readonly #runResults;
  readonly #runEntity;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;

    this.#benchmarkRunList = createReplicaSlice(benchmarkRunListResource, {
      actionPrefix: n('benchmarkRunList'),
      entity: arrayEntity<AgentEvalRunListItem>((run) => run.id),
      fetcher: ({ benchmarkId }) => agentEvalService.listRuns({ benchmarkId }),
      get,
      merge: (response) => response.data,
      set,
      stateKey: 'runListReplica',
      view: recordLens<EvalStore, AgentEvalRunListItem[]>('runListMap'),
    });
    this.#datasetRunList = createReplicaSlice(datasetRunListResource, {
      actionPrefix: n('datasetRunList'),
      entity: arrayEntity<AgentEvalRunListItem>((run) => run.id),
      fetcher: ({ datasetId }) => agentEvalService.listRuns({ datasetId }),
      get,
      merge: (response) => response.data,
      set,
      stateKey: 'datasetRunListReplica',
      view: recordLens<EvalStore, AgentEvalRunListItem[]>('datasetRunListMap'),
    });
    this.#runDetail = createReplicaSlice(runDetailResource, {
      actionPrefix: n('runDetail'),
      // The detail is a superset of the list row: the same run is patched here
      // and in the lists when a mutation fans out through `#runEntity`.
      entity: singleEntity<AgentEvalRunDetail, AgentEvalRunListItem>((run) => run.id),
      fetcher: (runId) => agentEvalService.getRunDetails(runId),
      get,
      set,
      stateKey: 'runDetailReplica',
      view: recordLens<EvalStore, AgentEvalRunDetail>('runDetailMap'),
    });
    this.#runResults = createReplicaSlice(runResultsResource, {
      actionPrefix: n('runResults'),
      fetcher: (runId) => agentEvalService.getRunResults(runId),
      get,
      set,
      stateKey: 'runResultsReplica',
      view: recordLens<EvalStore, AgentEvalRunResults>('runResultsMap'),
    });
    this.#runEntity = linkReplicaEntity<AgentEvalRunListItem>([
      this.#benchmarkRunList,
      this.#datasetRunList,
      this.#runDetail,
    ]);
  }

  abortRun = async (id: string): Promise<void> => {
    await agentEvalService.abortRun(id);
    await this.refreshRunDetail(id);
  };

  createRun = async (params: {
    config?: EvalRunInputConfig;
    datasetId: string;
    experimentId?: string;
    name?: string;
    parentRunId?: string;
    targetAgentId?: string;
  }): Promise<any> => {
    this.#set({ isCreatingRun: true }, false, n('createRun/start'));
    try {
      const result = await agentEvalService.createRun(params);
      // Experiment-scoped runs are served by the experiment detail payload;
      // benchmark-scoped runs by the benchmark run list.
      if (params.experimentId) {
        await this.#get().refreshExperimentDetail(params.experimentId);
      } else {
        await this.refreshRuns();
      }
      return result;
    } finally {
      this.#set({ isCreatingRun: false }, false, n('createRun/end'));
    }
  };

  deleteRun = async (id: string): Promise<void> => {
    await agentEvalService.deleteRun(id);
    // Drop the run from every list / detail copy that currently holds it, plus
    // its (unlinked) result payload.
    this.#runEntity.remove(id);
    this.#runResults.remove(id);
    await this.refreshRuns();
  };

  refreshDatasetRuns = async (datasetId: string): Promise<void> => {
    await this.#datasetRunList.revalidate(datasetId);
  };

  refreshRunDetail = async (id: string): Promise<void> => {
    await this.#runDetail.revalidate(id);
  };

  refreshRuns = async (benchmarkId?: string): Promise<void> => {
    await this.#benchmarkRunList.revalidate(benchmarkId);
  };

  batchResumeRunCases = async (
    runId: string,
    targets: Array<{ testCaseId: string; threadId?: string }>,
  ): Promise<void> => {
    await agentEvalService.batchResumeRunCases(runId, targets);
    await Promise.all([this.refreshRunDetail(runId), this.#runResults.revalidate(runId)]);
  };

  retryRunCase = async (runId: string, testCaseId: string): Promise<void> => {
    await agentEvalService.retryRunCase(runId, testCaseId);
    await this.refreshRunDetail(runId);
  };

  resumeRunCase = async (runId: string, testCaseId: string, threadId?: string): Promise<void> => {
    await agentEvalService.resumeRunCase(runId, testCaseId, threadId);
    await this.refreshRunDetail(runId);
  };

  retryRunErrors = async (id: string): Promise<void> => {
    await agentEvalService.retryRunErrors(id);
    await this.refreshRunDetail(id);
  };

  startRun = async (id: string, force?: boolean): Promise<void> => {
    await agentEvalService.startRun(id, force);
    await this.refreshRunDetail(id);
  };

  updateRun = async (params: {
    config?: EvalRunInputConfig;
    datasetId?: string;
    id: string;
    name?: string;
    targetAgentId?: string | null;
  }): Promise<any> => {
    const result = await agentEvalService.updateRun(params);
    await this.refreshRunDetail(params.id);
    await this.refreshRuns();
    return result;
  };

  useFetchRunDetail = (id: string, config?: FetchConfig): ReplicaSyncResult =>
    this.#runDetail.useSync(id || null, config);

  useFetchRunResults = (id: string, config?: FetchConfig): ReplicaSyncResult =>
    this.#runResults.useSync(id || null, config);

  useFetchDatasetRuns = (datasetId?: string): ReplicaSyncResult =>
    this.#datasetRunList.useSync(datasetId ? { datasetId } : null);

  useFetchRuns = (benchmarkId?: string): ReplicaSyncResult =>
    this.#benchmarkRunList.useSync(benchmarkId ? { benchmarkId } : null);
}

export type RunAction = Pick<RunActionImpl, keyof RunActionImpl>;

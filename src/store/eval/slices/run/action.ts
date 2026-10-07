import type { EvalRunInputConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';

import { type RunDetailDispatch, runDetailReducer } from './reducer';

type Setter = StoreSetter<EvalStore>;

export const createRunSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new RunActionImpl(set, get, _api);

export class RunActionImpl {
  readonly #get: () => EvalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  abortRun = async (id: string): Promise<void> => {
    await agentEvalService.abortRun(id);
    await this.#get().refreshRunDetail(id);
  };

  createRun = async (params: {
    config?: EvalRunInputConfig;
    datasetId: string;
    experimentId?: string;
    name?: string;
    parentRunId?: string;
    targetAgentId?: string;
  }): Promise<any> => {
    this.#set({ isCreatingRun: true }, false, 'createRun/start');
    try {
      const result = await agentEvalService.createRun(params);
      // Experiment-scoped runs are served by the experiment detail payload;
      // benchmark-scoped runs by the benchmark run list.
      if (params.experimentId) {
        await this.#get().refreshExperimentDetail(params.experimentId);
      } else {
        await this.#get().refreshRuns();
      }
      return result;
    } finally {
      this.#set({ isCreatingRun: false }, false, 'createRun/end');
    }
  };

  /** One run per subject model for the same agent; refreshes the same list `createRun` does. */
  createSubjectRuns = async (
    params: Parameters<typeof agentEvalService.createSubjectRuns>[0],
  ): Promise<{ id: string }[]> => {
    this.#set({ isCreatingRun: true }, false, 'createSubjectRuns/start');
    try {
      const runs = await agentEvalService.createSubjectRuns(params);
      if (params.experimentId) {
        await this.#get().refreshExperimentDetail(params.experimentId);
      } else {
        await this.#get().refreshRuns();
      }
      return runs;
    } finally {
      this.#set({ isCreatingRun: false }, false, 'createSubjectRuns/end');
    }
  };

  deleteRun = async (id: string): Promise<void> => {
    await agentEvalService.deleteRun(id);
    this.#get().internal_dispatchRunDetail({ id, type: 'deleteRunDetail' });
    await this.#get().refreshRuns();
  };

  internal_dispatchRunDetail = (payload: RunDetailDispatch): void => {
    const currentMap = this.#get().runDetailMap;
    const nextMap = runDetailReducer(currentMap, payload);

    if (isEqual(nextMap, currentMap)) return;

    this.#set({ runDetailMap: nextMap }, false, `dispatchRunDetail/${payload.type}`);
  };

  internal_updateRunDetailLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) {
          return { loadingRunDetailIds: [...state.loadingRunDetailIds, id] };
        }
        return {
          loadingRunDetailIds: state.loadingRunDetailIds.filter((i) => i !== id),
        };
      },
      false,
      'updateRunDetailLoading',
    );
  };

  internal_updateRunResultLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) {
          return { loadingRunResultIds: [...state.loadingRunResultIds, id] };
        }
        return {
          loadingRunResultIds: state.loadingRunResultIds.filter((i) => i !== id),
        };
      },
      false,
      'updateRunResultLoading',
    );
  };

  refreshDatasetRuns = async (datasetId: string): Promise<void> => {
    await mutate(evalKeys.datasetRuns(datasetId));
  };

  refreshRunDetail = async (id: string): Promise<void> => {
    await mutate(evalKeys.runDetail(id));
  };

  refreshRuns = async (benchmarkId?: string): Promise<void> => {
    if (benchmarkId) {
      await mutate(evalKeys.runs(benchmarkId));
    } else {
      await mutate((key) => Array.isArray(key) && key[0] === evalKeys.runs.root);
    }
  };

  batchResumeRunCases = async (
    runId: string,
    targets: Array<{ testCaseId: string; threadId?: string }>,
  ): Promise<void> => {
    await agentEvalService.batchResumeRunCases(runId, targets);
    await Promise.all([this.#get().refreshRunDetail(runId), mutate(evalKeys.runResults(runId))]);
  };

  retryRunCase = async (runId: string, testCaseId: string): Promise<void> => {
    await agentEvalService.retryRunCase(runId, testCaseId);
    await this.#get().refreshRunDetail(runId);
  };

  resumeRunCase = async (runId: string, testCaseId: string, threadId?: string): Promise<void> => {
    await agentEvalService.resumeRunCase(runId, testCaseId, threadId);
    await this.#get().refreshRunDetail(runId);
  };

  /** Re-dispatch the errored cells of a cross-model comparison and refetch its grid. */
  retryReplayComparisonErrors = async (runId: string): Promise<{ cellCount: number }> => {
    const result = await agentEvalService.retryReplayComparisonErrors(runId);
    await mutate(evalKeys.replayComparison(runId));
    return result;
  };

  /**
   * The model × case grid of one replay run. Polls while cells are still being
   * replayed or judged, so the page settles on its own without a manual refresh.
   */
  useFetchReplayComparison = (runId?: string) =>
    useClientDataSWR(
      runId ? evalKeys.replayComparison(runId) : null,
      () => agentEvalService.getReplayComparison(runId!),
      {
        refreshInterval: (data) =>
          data && ['pending', 'running'].includes(data.run.status as string) ? 3000 : 0,
      },
    );

  /** Every comparison one test case took part in, newest first. */
  useFetchTestCaseComparisons = (testCaseId?: string) =>
    useClientDataSWR(
      testCaseId ? evalKeys.testCaseComparisons(testCaseId) : null,
      () => agentEvalService.listReplayComparisonsByTestCase(testCaseId!),
      {
        // Cells fill in from a background workflow; keep polling until none is
        // left pending or running, then stop.
        refreshInterval: (data?: { cells: { status: string }[] }[]) =>
          data?.some((entry) =>
            entry.cells.some((cell) => cell.status === 'pending' || cell.status === 'running'),
          )
            ? 3000
            : 0,
      },
    );

  retryRunErrors = async (id: string): Promise<void> => {
    await agentEvalService.retryRunErrors(id);
    await this.#get().refreshRunDetail(id);
  };

  startRun = async (id: string, force?: boolean): Promise<void> => {
    await agentEvalService.startRun(id, force);
    await this.#get().refreshRunDetail(id);
  };

  updateRun = async (params: {
    config?: EvalRunInputConfig;
    datasetId?: string;
    id: string;
    name?: string;
    targetAgentId?: string | null;
  }): Promise<any> => {
    const result = await agentEvalService.updateRun(params);
    await this.#get().refreshRunDetail(params.id);
    await this.#get().refreshRuns();
    return result;
  };

  useFetchRunDetail = (id: string, config?: { refreshInterval?: number }): SWRResponse =>
    useClientDataSWR(id ? evalKeys.runDetail(id) : null, () => agentEvalService.getRunDetails(id), {
      ...config,
      onSuccess: (data: any) => {
        this.#get().internal_dispatchRunDetail({
          id,
          type: 'setRunDetail',
          value: data,
        });
        this.#get().internal_updateRunDetailLoading(id, false);
      },
    });

  useFetchRunResults = (id: string, config?: { refreshInterval?: number }): SWRResponse =>
    useClientDataSWR(
      id ? evalKeys.runResults(id) : null,
      () => agentEvalService.getRunResults(id),
      {
        ...config,
        onSuccess: (data: any) => {
          this.#set(
            (state) => ({
              runResultsMap: { ...state.runResultsMap, [id]: data },
            }),
            false,
            'useFetchRunResults/success',
          );
          this.#get().internal_updateRunResultLoading(id, false);
        },
      },
    );

  useFetchDatasetRuns = (datasetId?: string): SWRResponse =>
    useClientDataSWR(
      datasetId ? evalKeys.datasetRuns(datasetId) : null,
      () => agentEvalService.listRuns({ datasetId: datasetId! }),
      {
        onSuccess: (data: any) => {
          this.#set(
            (state) => ({
              datasetRunListMap: { ...state.datasetRunListMap, [datasetId!]: data.data },
            }),
            false,
            'useFetchDatasetRuns/success',
          );
        },
      },
    );

  useFetchRuns = (benchmarkId?: string): SWRResponse =>
    useClientDataSWR(
      benchmarkId ? evalKeys.runs(benchmarkId) : null,
      () => agentEvalService.listRuns({ benchmarkId: benchmarkId! }),
      {
        onSuccess: (data: any) => {
          this.#set({ isLoadingRuns: false, runList: data.data }, false, 'useFetchRuns/success');
        },
      },
    );
}

export type RunAction = Pick<RunActionImpl, keyof RunActionImpl>;

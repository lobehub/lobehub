import type { EvalRunInputConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';

import { type RunDetailDispatch, runDetailReducer } from './reducer';

const FETCH_RUNS_KEY = 'FETCH_EVAL_RUNS';
const FETCH_DATASET_RUNS_KEY = 'FETCH_EVAL_DATASET_RUNS';
const FETCH_RUN_DETAIL_KEY = 'FETCH_EVAL_RUN_DETAIL';
const FETCH_RUN_RESULTS_KEY = 'FETCH_EVAL_RUN_RESULTS';

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
    name?: string;
    targetAgentId?: string;
  }): Promise<any> => {
    this.#set({ isCreatingRun: true }, false, 'createRun/start');
    try {
      const result = await agentEvalService.createRun(params);
      await this.#get().refreshRuns();
      return result;
    } finally {
      this.#set({ isCreatingRun: false }, false, 'createRun/end');
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
    await mutate([FETCH_DATASET_RUNS_KEY, datasetId]);
  };

  refreshRunDetail = async (id: string): Promise<void> => {
    await mutate([FETCH_RUN_DETAIL_KEY, id]);
  };

  refreshRuns = async (benchmarkId?: string): Promise<void> => {
    if (benchmarkId) {
      await mutate([FETCH_RUNS_KEY, benchmarkId]);
    } else {
      await mutate((key) => Array.isArray(key) && key[0] === FETCH_RUNS_KEY);
    }
  };

  batchResumeRunCases = async (
    runId: string,
    targets: Array<{ testCaseId: string; threadId?: string }>,
  ): Promise<void> => {
    await agentEvalService.batchResumeRunCases(runId, targets);
    await Promise.all([
      this.#get().refreshRunDetail(runId),
      mutate([FETCH_RUN_RESULTS_KEY, runId]),
    ]);
  };

  retryRunCase = async (runId: string, testCaseId: string): Promise<void> => {
    await agentEvalService.retryRunCase(runId, testCaseId);
    await this.#get().refreshRunDetail(runId);
  };

  resumeRunCase = async (runId: string, testCaseId: string, threadId?: string): Promise<void> => {
    await agentEvalService.resumeRunCase(runId, testCaseId, threadId);
    await this.#get().refreshRunDetail(runId);
  };

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
    useClientDataSWR(
      id ? [FETCH_RUN_DETAIL_KEY, id] : null,
      () => agentEvalService.getRunDetails(id),
      {
        ...config,
        onSuccess: (data: any) => {
          this.#get().internal_dispatchRunDetail({
            id,
            type: 'setRunDetail',
            value: data,
          });
          this.#get().internal_updateRunDetailLoading(id, false);
        },
      },
    );

  useFetchRunResults = (id: string, config?: { refreshInterval?: number }): SWRResponse =>
    useClientDataSWR(
      id ? [FETCH_RUN_RESULTS_KEY, id] : null,
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
      datasetId ? [FETCH_DATASET_RUNS_KEY, datasetId] : null,
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
      benchmarkId ? [FETCH_RUNS_KEY, benchmarkId] : null,
      () => agentEvalService.listRuns({ benchmarkId: benchmarkId! }),
      {
        onSuccess: (data: any) => {
          this.#set({ isLoadingRuns: false, runList: data.data }, false, 'useFetchRuns/success');
        },
      },
    );
}

export type RunAction = Pick<RunActionImpl, keyof RunActionImpl>;

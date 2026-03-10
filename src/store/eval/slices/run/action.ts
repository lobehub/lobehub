import type { EvalRunInputConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';

import { type RunDetailDispatch, runDetailReducer } from './reducer';

const FETCH_RUNS_KEY = 'FETCH_EVAL_RUNS';
const FETCH_DATASET_RUNS_KEY = 'FETCH_EVAL_DATASET_RUNS';
const FETCH_RUN_DETAIL_KEY = 'FETCH_EVAL_RUN_DETAIL';
const FETCH_RUN_RESULTS_KEY = 'FETCH_EVAL_RUN_RESULTS';

export interface RunAction {
  abortRun: (id: string) => Promise<void>;
  createRun: (params: {
    config?: EvalRunInputConfig;
    datasetId: string;
    name?: string;
    targetAgentId?: string;
  }) => Promise<any>;
  deleteRun: (id: string) => Promise<void>;
  internal_dispatchRunDetail: (payload: RunDetailDispatch) => void;
  internal_updateRunDetailLoading: (id: string, loading: boolean) => void;
  internal_updateRunResultLoading: (id: string, loading: boolean) => void;
  refreshDatasetRuns: (datasetId: string) => Promise<void>;
  refreshRunDetail: (id: string) => Promise<void>;
  refreshRuns: (benchmarkId?: string) => Promise<void>;
  retryRunCase: (runId: string, testCaseId: string) => Promise<void>;
  retryRunErrors: (id: string) => Promise<void>;
  startRun: (id: string, force?: boolean) => Promise<void>;
  updateRun: (params: {
    config?: EvalRunInputConfig;
    datasetId?: string;
    id: string;
    name?: string;
    targetAgentId?: string | null;
  }) => Promise<any>;
  useFetchDatasetRuns: (datasetId?: string) => SWRResponse;
  useFetchRunDetail: (id: string, config?: { refreshInterval?: number }) => SWRResponse;
  useFetchRunResults: (id: string, config?: { refreshInterval?: number }) => SWRResponse;
  useFetchRuns: (benchmarkId?: string) => SWRResponse;
}

export const createRunSlice: StateCreator<
  EvalStore,
  [['zustand/devtools', never]],
  [],
  RunAction
> = (set, get) => ({
  abortRun: async (id) => {
    await agentEvalService.abortRun(id);
    await get().refreshRunDetail(id);
  },

  createRun: async (params) => {
    set({ isCreatingRun: true }, false, 'createRun/start');
    try {
      const result = await agentEvalService.createRun(params);
      await get().refreshRuns();
      return result;
    } finally {
      set({ isCreatingRun: false }, false, 'createRun/end');
    }
  },

  deleteRun: async (id) => {
    await agentEvalService.deleteRun(id);
    get().internal_dispatchRunDetail({ id, type: 'deleteRunDetail' });
    await get().refreshRuns();
  },

  internal_dispatchRunDetail: (payload) => {
    const currentMap = get().runDetailMap;
    const nextMap = runDetailReducer(currentMap, payload);

    if (isEqual(nextMap, currentMap)) return;

    set({ runDetailMap: nextMap }, false, `dispatchRunDetail/${payload.type}`);
  },

  internal_updateRunDetailLoading: (id, loading) => {
    set(
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
  },

  internal_updateRunResultLoading: (id, loading) => {
    set(
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
  },

  refreshDatasetRuns: async (datasetId) => {
    await mutate([FETCH_DATASET_RUNS_KEY, datasetId]);
  },

  refreshRunDetail: async (id) => {
    await mutate([FETCH_RUN_DETAIL_KEY, id]);
  },

  refreshRuns: async (benchmarkId) => {
    if (benchmarkId) {
      await mutate([FETCH_RUNS_KEY, benchmarkId]);
    } else {
      // Revalidate all benchmark-level run list entries
      await mutate((key) => Array.isArray(key) && key[0] === FETCH_RUNS_KEY);
    }
  },

  retryRunCase: async (runId, testCaseId) => {
    await agentEvalService.retryRunCase(runId, testCaseId);
    await get().refreshRunDetail(runId);
  },

  retryRunErrors: async (id) => {
    await agentEvalService.retryRunErrors(id);
    await get().refreshRunDetail(id);
  },

  startRun: async (id, force) => {
    await agentEvalService.startRun(id, force);
    await get().refreshRunDetail(id);
  },

  updateRun: async (params) => {
    const result = await agentEvalService.updateRun(params);
    await get().refreshRunDetail(params.id);
    await get().refreshRuns();
    return result;
  },

  useFetchRunDetail: (id, config) => {
    return useClientDataSWR(
      id ? [FETCH_RUN_DETAIL_KEY, id] : null,
      () => agentEvalService.getRunDetails(id),
      {
        ...config,
        onSuccess: (data: any) => {
          get().internal_dispatchRunDetail({
            id,
            type: 'setRunDetail',
            value: data,
          });
          get().internal_updateRunDetailLoading(id, false);
        },
      },
    );
  },

  useFetchRunResults: (id, config) => {
    return useClientDataSWR(
      id ? [FETCH_RUN_RESULTS_KEY, id] : null,
      () => agentEvalService.getRunResults(id),
      {
        ...config,
        onSuccess: (data: any) => {
          set(
            (state) => ({
              runResultsMap: { ...state.runResultsMap, [id]: data },
            }),
            false,
            'useFetchRunResults/success',
          );
          get().internal_updateRunResultLoading(id, false);
        },
      },
    );
  },

  useFetchDatasetRuns: (datasetId) => {
    return useClientDataSWR(
      datasetId ? [FETCH_DATASET_RUNS_KEY, datasetId] : null,
      () => agentEvalService.listRuns({ datasetId: datasetId! }),
      {
        onSuccess: (data: any) => {
          set(
            (state) => ({
              datasetRunListMap: { ...state.datasetRunListMap, [datasetId!]: data.data },
            }),
            false,
            'useFetchDatasetRuns/success',
          );
        },
      },
    );
  },

  useFetchRuns: (benchmarkId) => {
    return useClientDataSWR(
      benchmarkId ? [FETCH_RUNS_KEY, benchmarkId] : null,
      () => agentEvalService.listRuns({ benchmarkId: benchmarkId! }),
      {
        onSuccess: (data: any) => {
          set({ isLoadingRuns: false, runList: data.data }, false, 'useFetchRuns/success');
        },
      },
    );
  },
});

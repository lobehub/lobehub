import isEqual from 'fast-deep-equal';
import  { type SWRResponse } from 'swr';
import  { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import  { type EvalStore } from '@/store/eval/store';

import { type BenchmarkDetailDispatch,benchmarkDetailReducer } from './reducer';

const FETCH_BENCHMARKS_KEY = 'FETCH_BENCHMARKS';
const FETCH_BENCHMARK_DETAIL_KEY = 'FETCH_BENCHMARK_DETAIL';

export interface BenchmarkAction {
  createBenchmark: (params: {
    description?: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    rubrics?: any[];
    tags?: string[];
  }) => Promise<any>;
  deleteBenchmark: (id: string) => Promise<void>;
  // Internal methods
  internal_dispatchBenchmarkDetail: (payload: BenchmarkDetailDispatch) => void;
  internal_updateBenchmarkDetailLoading: (id: string, loading: boolean) => void;
  refreshBenchmarkDetail: (id: string) => Promise<void>;
  refreshBenchmarks: () => Promise<void>;
  updateBenchmark: (params: {
    description?: string;
    id: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    tags?: string[];
  }) => Promise<void>;

  useFetchBenchmarkDetail: (id?: string) => SWRResponse;
  useFetchBenchmarks: () => SWRResponse;
}

export const createBenchmarkSlice: StateCreator<
  EvalStore,
  [['zustand/devtools', never]],
  [],
  BenchmarkAction
> = (set, get) => ({
  createBenchmark: async (params) => {
    set({ isCreatingBenchmark: true }, false, 'createBenchmark/start');
    try {
      const result = await agentEvalService.createBenchmark({
        identifier: params.identifier,
        name: params.name,
        description: params.description,
        metadata: params.metadata,
        rubrics: params.rubrics ?? [],
        tags: params.tags,
      });
      await get().refreshBenchmarks();
      return result;
    } finally {
      set({ isCreatingBenchmark: false }, false, 'createBenchmark/end');
    }
  },

  deleteBenchmark: async (id) => {
    set({ isDeletingBenchmark: true }, false, 'deleteBenchmark/start');
    try {
      await agentEvalService.deleteBenchmark(id);
      await get().refreshBenchmarks();
    } finally {
      set({ isDeletingBenchmark: false }, false, 'deleteBenchmark/end');
    }
  },

  refreshBenchmarkDetail: async (id) => {
    await mutate([FETCH_BENCHMARK_DETAIL_KEY, id]);
  },

  refreshBenchmarks: async () => {
    await mutate(FETCH_BENCHMARKS_KEY);
  },

  updateBenchmark: async (params) => {
    const { id } = params;

    // 1. Optimistic update
    get().internal_dispatchBenchmarkDetail({
      type: 'updateBenchmarkDetail',
      id,
      value: params,
    });

    // 2. Set loading
    get().internal_updateBenchmarkDetailLoading(id, true);

    try {
      // 3. Call service
      await agentEvalService.updateBenchmark({
        id: params.id,
        identifier: params.identifier,
        name: params.name,
        description: params.description,
        metadata: params.metadata,
        tags: params.tags,
      });

      // 4. Refresh from server
      await get().refreshBenchmarks();
      await get().refreshBenchmarkDetail(id);
    } finally {
      get().internal_updateBenchmarkDetailLoading(id, false);
    }
  },

  useFetchBenchmarkDetail: (id) => {
    return useClientDataSWR(
      id ? [FETCH_BENCHMARK_DETAIL_KEY, id] : null,
      () => agentEvalService.getBenchmark(id!),
      {
        onSuccess: (data: any) => {
          get().internal_dispatchBenchmarkDetail({
            type: 'setBenchmarkDetail',
            id: id!,
            value: data,
          });
          get().internal_updateBenchmarkDetailLoading(id!, false);
        },
      },
    );
  },

  useFetchBenchmarks: () => {
    return useClientDataSWR(FETCH_BENCHMARKS_KEY, () => agentEvalService.listBenchmarks(), {
      onSuccess: (data: any) => {
        set(
          { benchmarkList: data, benchmarkListInit: true, isLoadingBenchmarkList: false },
          false,
          'useFetchBenchmarks/success',
        );
      },
    });
  },

  // Internal - Dispatch to reducer
  internal_dispatchBenchmarkDetail: (payload) => {
    const currentMap = get().benchmarkDetailMap;
    const nextMap = benchmarkDetailReducer(currentMap, payload);

    // No need to update if map is the same
    if (isEqual(nextMap, currentMap)) return;

    set({ benchmarkDetailMap: nextMap }, false, `dispatchBenchmarkDetail/${payload.type}`);
  },

  // Internal - Update loading state for specific detail
  internal_updateBenchmarkDetailLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          return { loadingBenchmarkDetailIds: [...state.loadingBenchmarkDetailIds, id] };
        }
        return {
          loadingBenchmarkDetailIds: state.loadingBenchmarkDetailIds.filter((i) => i !== id),
        };
      },
      false,
      'updateBenchmarkDetailLoading',
    );
  },
});

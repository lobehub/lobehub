import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import { type EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';

import { type BenchmarkDetailDispatch, benchmarkDetailReducer } from './reducer';

const FETCH_BENCHMARKS_KEY = 'FETCH_BENCHMARKS';
const FETCH_BENCHMARK_DETAIL_KEY = 'FETCH_BENCHMARK_DETAIL';

type Setter = StoreSetter<EvalStore>;

export const createBenchmarkSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new BenchmarkActionImpl(set, get, _api);

export class BenchmarkActionImpl {
  readonly #get: () => EvalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createBenchmark = async (params: {
    description?: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    rubrics?: any[];
    tags?: string[];
  }): Promise<any> => {
    this.#set({ isCreatingBenchmark: true }, false, 'createBenchmark/start');
    try {
      const result = await agentEvalService.createBenchmark({
        description: params.description,
        identifier: params.identifier,
        metadata: params.metadata,
        name: params.name,
        rubrics: params.rubrics ?? [],
        tags: params.tags,
      });
      await this.#get().refreshBenchmarks();
      return result;
    } finally {
      this.#set({ isCreatingBenchmark: false }, false, 'createBenchmark/end');
    }
  };

  deleteBenchmark = async (id: string): Promise<void> => {
    this.#set({ isDeletingBenchmark: true }, false, 'deleteBenchmark/start');
    try {
      await agentEvalService.deleteBenchmark(id);
      await this.#get().refreshBenchmarks();
    } finally {
      this.#set({ isDeletingBenchmark: false }, false, 'deleteBenchmark/end');
    }
  };

  refreshBenchmarkDetail = async (id: string): Promise<void> => {
    await mutate([FETCH_BENCHMARK_DETAIL_KEY, id]);
  };

  refreshBenchmarks = async (): Promise<void> => {
    await mutate(FETCH_BENCHMARKS_KEY);
  };

  updateBenchmark = async (params: {
    description?: string;
    id: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    tags?: string[];
  }): Promise<void> => {
    const { id } = params;

    this.#get().internal_dispatchBenchmarkDetail({
      id,
      type: 'updateBenchmarkDetail',
      value: params,
    });

    this.#get().internal_updateBenchmarkDetailLoading(id, true);

    try {
      await agentEvalService.updateBenchmark({
        description: params.description,
        id: params.id,
        identifier: params.identifier,
        metadata: params.metadata,
        name: params.name,
        tags: params.tags,
      });

      await this.#get().refreshBenchmarks();
      await this.#get().refreshBenchmarkDetail(id);
    } finally {
      this.#get().internal_updateBenchmarkDetailLoading(id, false);
    }
  };

  useFetchBenchmarkDetail = (id?: string): SWRResponse =>
    useClientDataSWR(
      id ? [FETCH_BENCHMARK_DETAIL_KEY, id] : null,
      () => agentEvalService.getBenchmark(id!),
      {
        onSuccess: (data: any) => {
          this.#get().internal_dispatchBenchmarkDetail({
            id: id!,
            type: 'setBenchmarkDetail',
            value: data,
          });
          this.#get().internal_updateBenchmarkDetailLoading(id!, false);
        },
      },
    );

  useFetchBenchmarks = (): SWRResponse =>
    useClientDataSWR(FETCH_BENCHMARKS_KEY, () => agentEvalService.listBenchmarks(), {
      onSuccess: (data: any) => {
        this.#set(
          { benchmarkList: data, benchmarkListInit: true, isLoadingBenchmarkList: false },
          false,
          'useFetchBenchmarks/success',
        );
      },
    });

  internal_dispatchBenchmarkDetail = (payload: BenchmarkDetailDispatch): void => {
    const currentMap = this.#get().benchmarkDetailMap;
    const nextMap = benchmarkDetailReducer(currentMap, payload);

    if (isEqual(nextMap, currentMap)) return;

    this.#set({ benchmarkDetailMap: nextMap }, false, `dispatchBenchmarkDetail/${payload.type}`);
  };

  internal_updateBenchmarkDetailLoading = (id: string, loading: boolean): void => {
    this.#set(
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
  };
}

export type BenchmarkAction = Pick<BenchmarkActionImpl, keyof BenchmarkActionImpl>;

import isEqual from 'fast-deep-equal';

import {
  arrayEntity,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import { type EvalStore, useEvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  BENCHMARK_LIST_KEY,
  type BenchmarkDetail,
  benchmarkDetailResource,
  type BenchmarkListItem,
  benchmarkListResource,
} from './projection';

type Setter = StoreSetter<EvalStore>;

/** The list has no params; the literal keeps `useSync` active with one entry. */
const LIST_PARAMS = {} as Record<string, never>;

/**
 * The benchmark list keeps its long-standing flat field (`benchmarkList`) as the
 * replica view, gated by `benchmarkListInit` so a loaded-but-empty list stays
 * distinguishable from one that was never fetched (the sidebar's skeleton gate).
 */
const benchmarkListLens: ReplicaLens<EvalStore, BenchmarkListItem[]> = {
  clear: () => ({ benchmarkList: [], benchmarkListInit: false }),
  get: (state) => (state.benchmarkListInit ? state.benchmarkList : undefined),
  keys: (state) => (state.benchmarkListInit ? [BENCHMARK_LIST_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { benchmarkList: data, benchmarkListInit: true }
      : { benchmarkList: [], benchmarkListInit: false },
};

/** Pre-migration `useFetchBenchmarks` return shape, backed by the list replica. */
export interface BenchmarkListSyncResult extends ReplicaSyncResult {
  /** The list once it has settled (hydrated or fetched), else `undefined`. */
  data: BenchmarkListItem[] | undefined;
  /** First load in flight with nothing settled yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the pre-migration call sites. */
  mutate: () => Promise<unknown>;
}

/** Pre-migration `useFetchBenchmarkDetail` return shape, backed by the detail replica. */
export interface BenchmarkDetailSyncResult {
  error: unknown;
  /** First load in flight with nothing settled yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the pre-migration call sites. */
  mutate: () => Promise<unknown>;
}

export const createBenchmarkSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new BenchmarkActionImpl(set, get, _api);

export class BenchmarkActionImpl {
  readonly #detail;
  readonly #entity;
  readonly #get: () => EvalStore;
  readonly #list;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(benchmarkListResource, {
      actionPrefix: 'benchmarkList',
      entity: arrayEntity<BenchmarkListItem>((benchmark) => benchmark.id),
      fetcher: () => agentEvalService.listBenchmarks(),
      get,
      set,
      stateKey: 'benchmarkListReplica',
      view: benchmarkListLens,
    });
    this.#detail = createReplicaSlice(benchmarkDetailResource, {
      actionPrefix: 'benchmarkDetail',
      entity: singleEntity<BenchmarkDetail>((benchmark) => benchmark.id),
      fetcher: (id) => agentEvalService.getBenchmark(id),
      get,
      // An unchanged page must not repaint the detail view.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'benchmarkDetailReplica',
      view: recordLens<EvalStore, BenchmarkDetail>('benchmarkDetailMap'),
    });
    // The same benchmark lives in the list and in its detail page: an edit or a
    // delete patches both copies at once.
    this.#entity = linkReplicaEntity<BenchmarkListItem>([this.#list, this.#detail]);
  }

  createBenchmark = async (params: {
    description?: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    rubrics?: any[];
    tags?: string[];
  }): Promise<any> => {
    const result = await agentEvalService.createBenchmark({
      description: params.description,
      identifier: params.identifier,
      metadata: params.metadata,
      name: params.name,
      rubrics: params.rubrics ?? [],
      tags: params.tags,
    });
    await this.refreshBenchmarks();
    return result;
  };

  deleteBenchmark = async (id: string): Promise<void> => {
    await agentEvalService.deleteBenchmark(id);
    // Drop the row from the list and the detail cache at once, then converge.
    this.#entity.remove(id);
    await this.refreshBenchmarks();
  };

  updateBenchmark = async (params: {
    description?: string;
    id: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    tags?: string[];
  }): Promise<void> => {
    // Optimistic on every copy; the refetch below reconciles server-owned fields.
    await this.#entity.optimistic(
      params.id,
      (benchmark) => ({ ...benchmark, ...params }),
      () =>
        agentEvalService.updateBenchmark({
          description: params.description,
          id: params.id,
          identifier: params.identifier,
          metadata: params.metadata,
          name: params.name,
          tags: params.tags,
        }),
    );
    await Promise.all([this.refreshBenchmarks(), this.refreshBenchmarkDetail(params.id)]);
  };

  refreshBenchmarkDetail = async (id: string): Promise<void> => {
    await this.#detail.revalidate(id);
  };

  refreshBenchmarks = async (): Promise<void> => {
    await this.#list.revalidate();
  };

  /**
   * Fetch orchestration only (the value is read from the store). Keeps the
   * pre-migration `{ data, error, isLoading, mutate }` shape so the overview's
   * `AsyncBoundary` and its retry keep working unchanged.
   */
  useFetchBenchmarks = (): BenchmarkListSyncResult => {
    // Subscribe so a replica commit (hydrate or server replace) re-renders the
    // consumer; the value itself is read through the store below.
    useEvalStore((s) => s.benchmarkListInit);
    const sync = this.#list.useSync(LIST_PARAMS);
    const { benchmarkList, benchmarkListInit } = this.#get();
    return {
      ...sync,
      data: benchmarkListInit ? benchmarkList : undefined,
      isLoading: !sync.isHydrated || (sync.isValidating && !benchmarkListInit),
      mutate: sync.revalidate,
    };
  };

  /**
   * Fetch orchestration only (the page is read from `benchmarkDetailMap`).
   * Keeps the pre-migration `{ error, isLoading, mutate }` shape.
   */
  useFetchBenchmarkDetail = (id?: string): BenchmarkDetailSyncResult => {
    const sync = this.#detail.useSync(id ?? null, {
      // A benchmark deleted elsewhere answers NOT_FOUND, yet a hydrated copy
      // would keep the page painting it (the route only shows the error when
      // the map entry is absent), even across reloads. NOT_FOUND is
      // definitive: drop the cached detail and its persisted row. Transient
      // failures keep the cached page on screen.
      onError: (error) => {
        if (id && isTrpcErrorCode(error, 'NOT_FOUND')) this.#detail.remove(id);
      },
    });
    return {
      error: sync.error,
      isLoading: !sync.isHydrated || sync.isValidating,
      mutate: sync.revalidate,
    };
  };
}

export type BenchmarkAction = Pick<BenchmarkActionImpl, keyof BenchmarkActionImpl>;

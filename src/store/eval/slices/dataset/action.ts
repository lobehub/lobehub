import type { AgentEvalDataset, AgentEvalDatasetListItem } from '@lobechat/types';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import { type EvalStore, useEvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  ALL_DATASETS_KEY,
  datasetDetailResource,
  datasetListResource,
  toDatasetDetail,
} from './projection';

type Setter = StoreSetter<EvalStore>;

/** The scope-wide list takes no params; the literal keeps `useSync` active. */
const ALL_DATASETS_PARAMS = {} as Record<string, never>;

/** Pre-migration `useFetchAllDatasets` return shape, backed by the scope-wide entry. */
export interface DatasetListSyncResult extends ReplicaSyncResult {
  /** The list once it has settled (hydrated or fetched), else `undefined`. */
  data: AgentEvalDatasetListItem[] | undefined;
  /** First load in flight with nothing settled yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the pre-migration call sites. */
  mutate: () => Promise<unknown>;
}

/** Pre-migration `useFetchDatasetDetail` return shape, backed by the detail replica. */
export interface DatasetDetailSyncResult {
  /** The dataset once it has settled (hydrated or fetched), else `undefined`. */
  data: AgentEvalDataset | undefined;
  error: unknown;
  /** First load in flight with nothing settled yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the pre-migration call sites. */
  mutate: () => Promise<unknown>;
}

export const createDatasetSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new DatasetActionImpl(set, get, _api);

export class DatasetActionImpl {
  readonly #detail;
  readonly #get: () => EvalStore;
  readonly #list;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#get = get;

    // Two local-first resources over the dataset entity, each owning ONE store
    // location (the selectors keep reading those maps):
    // - `#list`: benchmark-scoped lists + the scope-wide list → `datasetListMap`
    // - `#detail`: by-id dataset page → `datasetDetailMap`
    this.#list = createReplicaSlice(datasetListResource, {
      actionPrefix: 'datasetList',
      fetcher: ({ benchmarkId }) =>
        benchmarkId
          ? agentEvalService.listDatasets(benchmarkId)
          : agentEvalService.listAllDatasets(),
      get,
      set,
      stateKey: 'datasetListReplica',
      view: recordLens<EvalStore, AgentEvalDatasetListItem[]>('datasetListMap'),
    });
    this.#detail = createReplicaSlice(datasetDetailResource, {
      actionPrefix: 'datasetDetail',
      fetcher: async (id) => toDatasetDetail(await agentEvalService.getDataset(id)),
      get,
      set,
      stateKey: 'datasetDetailReplica',
      view: recordLens<EvalStore, AgentEvalDataset>('datasetDetailMap'),
    });
  }

  refreshDatasetDetail = async (id: string): Promise<void> => {
    await this.#detail.revalidate(id);
  };

  refreshDatasets = async (benchmarkId: string): Promise<void> => {
    await this.#list.revalidate(benchmarkId);
  };

  /**
   * Fetch orchestration only (the dataset is read from `datasetDetailMap`).
   * Keeps the pre-migration `{ data, error, isLoading, mutate }` shape.
   */
  useFetchDatasetDetail = (id?: string): DatasetDetailSyncResult => {
    const sync = this.#detail.useSync(id ?? null, {
      // A dataset deleted by another client keeps answering NOT_FOUND, and the
      // persisted detail would otherwise keep painting it — `AsyncBoundary` sees
      // `data` defined and swallows the fetch error. NOT_FOUND is definitive, so
      // drop the cached row and let the page settle on its error state; any
      // transient failure keeps the persisted copy on screen.
      onError: (error) => {
        if (!id || !isTrpcErrorCode(error, 'NOT_FOUND')) return;
        this.#detail.remove(id);
      },
    });
    // Subscribe so a replica commit (hydrate or server replace) re-renders the
    // consumer; the value itself is read through the store below.
    useEvalStore((s) => (id ? s.datasetDetailMap[id] : undefined));
    const data = id ? this.#get().datasetDetailMap[id] : undefined;
    return {
      data,
      error: sync.error,
      // A failed first load is neither loading nor settled: gate on the error
      // so the page falls through to its error state instead of a skeleton.
      isLoading: data === undefined && !sync.error,
      mutate: sync.revalidate,
    };
  };

  /**
   * Fetch orchestration only; read the rows with `datasetSelectors.datasetList`.
   */
  useFetchDatasets = (benchmarkId?: string): ReplicaSyncResult =>
    this.#list.useSync(benchmarkId ? { benchmarkId } : null);

  /**
   * Every dataset. Without this a dataset is only reachable through its
   * benchmark, so one belonging to none could be created but never found.
   * Keeps the pre-migration `{ data, isLoading }` shape.
   */
  useFetchAllDatasets = (): DatasetListSyncResult => {
    // Subscribe so a replica commit re-renders the consumer (sidebar / overview);
    // the value itself is read through the store below.
    useEvalStore((s) => s.datasetListMap[ALL_DATASETS_KEY]);
    const sync = this.#list.useSync(ALL_DATASETS_PARAMS);
    const data = this.#get().datasetListMap[ALL_DATASETS_KEY];
    return {
      ...sync,
      data,
      isLoading: data === undefined && !sync.error,
      mutate: sync.revalidate,
    };
  };
}

export type DatasetAction = Pick<DatasetActionImpl, keyof DatasetActionImpl>;

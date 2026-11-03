import { type AgentEvalExperimentDetail, type AgentEvalExperimentListItem } from '@lobechat/types';

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

import {
  EXPERIMENT_LIST_KEY,
  experimentDetailResource,
  experimentListResource,
} from './projection';

type Setter = StoreSetter<EvalStore>;

/** The list has no params; the literal keeps `useSync` active with one entry. */
const LIST_PARAMS = {} as Record<string, never>;

/**
 * The experiment list keeps its long-standing flat field (`experimentList`) as
 * the replica view, gated by `experimentListInit` so a loaded-but-empty list
 * stays distinguishable from one that was never fetched (the sidebar's
 * skeleton gate).
 */
const experimentListLens: ReplicaLens<EvalStore, AgentEvalExperimentListItem[]> = {
  clear: () => ({ experimentList: [], experimentListInit: false }),
  get: (state) => (state.experimentListInit ? state.experimentList : undefined),
  keys: (state) => (state.experimentListInit ? [EXPERIMENT_LIST_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { experimentList: data, experimentListInit: true }
      : { experimentList: [], experimentListInit: false },
};

/** Pre-migration `useFetchExperiments` return shape, backed by the list replica. */
export interface ExperimentListSyncResult extends ReplicaSyncResult {
  /** The list once it has settled (hydrated or fetched), else `undefined`. */
  data: AgentEvalExperimentListItem[] | undefined;
  /** First load in flight with nothing settled yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the pre-migration call sites. */
  mutate: () => Promise<unknown>;
}

/** Pre-migration `useFetchExperimentDetail` return shape, backed by the detail replica. */
export interface ExperimentDetailSyncResult {
  error: unknown;
  /** First load in flight with nothing settled yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the pre-migration call sites. */
  mutate: () => Promise<unknown>;
}

export const createExperimentSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new ExperimentActionImpl(set, get, _api);

export class ExperimentActionImpl {
  readonly #detail;
  readonly #entity;
  readonly #get: () => EvalStore;
  readonly #list;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#get = get;

    this.#list = createReplicaSlice(experimentListResource, {
      actionPrefix: 'experimentList',
      entity: arrayEntity<AgentEvalExperimentListItem>((experiment) => experiment.id),
      fetcher: () => agentEvalService.listExperiments(),
      get,
      merge: (response) => response.data,
      set,
      stateKey: 'experimentListReplica',
      view: experimentListLens,
    });
    this.#detail = createReplicaSlice(experimentDetailResource, {
      actionPrefix: 'experimentDetail',
      // The detail is a superset of the list row: the same experiment is
      // patched here and in the list when a mutation fans out through
      // `#entity`.
      entity: singleEntity<AgentEvalExperimentDetail, AgentEvalExperimentListItem>(
        (experiment) => experiment.id,
      ),
      fetcher: (id) => agentEvalService.getExperiment(id),
      get,
      merge: (response) => response.data,
      set,
      stateKey: 'experimentDetailReplica',
      view: recordLens<EvalStore, AgentEvalExperimentDetail>('experimentDetailMap'),
    });
    // The same experiment lives in the list and in its workspace page: an edit
    // or a delete patches both copies at once.
    this.#entity = linkReplicaEntity<AgentEvalExperimentListItem>([this.#list, this.#detail]);
  }

  createExperiment = async (params: {
    benchmarkIds: string[];
    description?: string;
    metadata?: Record<string, unknown>;
    name: string;
  }): Promise<any> => {
    const result = await agentEvalService.createExperiment(params);
    await this.refreshExperiments();
    return result.data;
  };

  deleteExperiment = async (id: string): Promise<void> => {
    // Optimistic: drop the row from the list (and the detail cache) right away,
    // rolling back if the server rejects it, then converge on the server list.
    await this.#entity.optimistic(id, 'remove', () => agentEvalService.deleteExperiment(id));
    await this.refreshExperiments();
  };

  updateExperiment = async (params: {
    benchmarkIds?: string[];
    description?: string;
    id: string;
    metadata?: Record<string, unknown>;
    name?: string;
  }): Promise<void> => {
    await agentEvalService.updateExperiment(params);
    await Promise.all([this.refreshExperiments(), this.refreshExperimentDetail(params.id)]);
  };

  refreshExperimentDetail = async (id: string): Promise<void> => {
    await this.#detail.revalidate(id);
  };

  refreshExperiments = async (): Promise<void> => {
    await this.#list.revalidate();
  };

  /**
   * Fetch orchestration only (the page is read from `experimentDetailMap`).
   * Keeps the pre-migration `{ error, isLoading, mutate }` shape.
   */
  useFetchExperimentDetail = (id?: string): ExperimentDetailSyncResult => {
    const sync = this.#detail.useSync(id || null);
    return {
      error: sync.error,
      // A failed first load is neither loading nor settled: gate on the error
      // so the page can fall through to its error state instead of a skeleton.
      isLoading: !sync.error && (!sync.isHydrated || sync.isValidating),
      mutate: sync.revalidate,
    };
  };

  /**
   * Fetch orchestration only (the list is read from the store). Keeps the
   * pre-migration `{ data, isLoading, error, mutate }` shape so the overview's
   * `AsyncBoundary` and the sidebar's skeleton/error gates keep working
   * unchanged.
   */
  useFetchExperiments = (): ExperimentListSyncResult => {
    // Subscribe so a replica commit (hydrate or server replace) re-renders the
    // consumer; the value itself is read through the store below.
    useEvalStore((s) => s.experimentListInit);
    const sync = this.#list.useSync(LIST_PARAMS);
    const { experimentList, experimentListInit } = this.#get();
    return {
      ...sync,
      data: experimentListInit ? experimentList : undefined,
      isLoading: !sync.error && !experimentListInit,
      mutate: sync.revalidate,
    };
  };
}

export type ExperimentAction = Pick<ExperimentActionImpl, keyof ExperimentActionImpl>;

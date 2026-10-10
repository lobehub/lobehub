import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import { type EvalStore, useEvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  type TestCaseDetail,
  testCaseDetailResource,
  type TestCaseListItem,
  testCaseListResource,
  type TestCaseListValue,
} from './projection';

const n = setNamespace('evalTestCase');

type Setter = StoreSetter<EvalStore>;

/** Params of a dataset's case page; `null` (or a blank datasetId) disables the sync. */
export interface TestCaseListParams {
  datasetId: string;
  limit?: number;
  offset?: number;
}

/** Pre-migration `useFetchTestCase` return shape, backed by the detail replica. */
export interface TestCaseDetailSyncResult {
  /** The case once it has settled (hydrated or fetched), else `undefined`. */
  data: TestCaseDetail | undefined;
  error: unknown;
  /** First load in flight with nothing settled yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the pre-migration call site. */
  mutate: () => Promise<unknown>;
}

export const createTestCaseSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new TestCaseActionImpl(set, get, _api);

export class TestCaseActionImpl {
  readonly #get: () => EvalStore;
  readonly #detail;
  readonly #list;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#get = get;

    // Two local-first resources over the test-case entity, each owning ONE store
    // location (selectors keep reading those maps):
    // - `#list`: a dataset's case page → `testCaseListMap[datasetId]`
    // - `#detail`: a case addressed by id → `testCaseDetailMap[id]`
    this.#list = createReplicaSlice(testCaseListResource, {
      actionPrefix: n('testCaseList'),
      fetcher: ({ datasetId, limit, offset }) =>
        agentEvalService.listTestCases({ datasetId, limit, offset }),
      get,
      merge: (response) => ({ items: response.data, total: response.total }),
      set,
      stateKey: 'testCaseListReplica',
      view: recordLens<EvalStore, TestCaseListValue>('testCaseListMap'),
    });
    this.#detail = createReplicaSlice(testCaseDetailResource, {
      actionPrefix: n('testCaseDetail'),
      fetcher: (id) => agentEvalService.getTestCase(id),
      get,
      set,
      stateKey: 'testCaseDetailReplica',
      view: recordLens<EvalStore, TestCaseDetail>('testCaseDetailMap'),
    });
  }

  getTestCaseById = (id: string): TestCaseDetail | undefined => this.#get().testCaseDetailMap[id];

  getTestCasesByDatasetId = (datasetId: string): TestCaseListItem[] =>
    this.#get().testCaseListMap[datasetId]?.items ?? [];

  getTestCasesTotalByDatasetId = (datasetId: string): number =>
    this.#get().testCaseListMap[datasetId]?.total ?? 0;

  isLoadingTestCases = (datasetId: string): boolean =>
    this.#get().testCaseListMap[datasetId] === undefined;

  refreshTestCaseDetail = async (id: string): Promise<void> => {
    await this.#detail.revalidate(id);
  };

  refreshTestCases = async (datasetId?: string): Promise<void> => {
    await this.#list.revalidate(datasetId);
  };

  /**
   * Edit a case definition in place. The dataset list is revalidated too: its
   * rows render the same input and expected answer, so leaving it alone shows a
   * stale row the moment you navigate back.
   */
  updateTestCase = async (
    id: string,
    datasetId: string,
    data: {
      content?: { expected?: string; input?: string };
      evalConfig?: { criteria?: string };
    },
  ): Promise<void> => {
    await agentEvalService.updateTestCase({ id, ...data });
    await Promise.all([this.refreshTestCaseDetail(id), this.refreshTestCases(datasetId)]);
  };

  /**
   * Fetch orchestration only; read the case from `testCaseDetailMap`. Keeps the
   * pre-migration `{ data, error, isLoading, mutate }` shape so the detail
   * route's NOT_FOUND handling is unchanged.
   */
  useFetchTestCase = (id?: string): TestCaseDetailSyncResult => {
    // Subscribe so a replica commit (hydrate or server replace) re-renders the
    // consumer; the value itself is read through the store below.
    useEvalStore((s) => (id ? s.testCaseDetailMap[id] : undefined));
    const sync = this.#detail.useSync(id ?? null);
    const data = id ? this.#get().testCaseDetailMap[id] : undefined;
    return {
      data,
      error: sync.error,
      // A failed first load is neither loading nor settled: gate on the error so
      // the route falls through to its error state instead of a skeleton.
      isLoading: data === undefined && !sync.error,
      mutate: sync.revalidate,
    };
  };

  /**
   * Fetch orchestration only; read the rows with `testCaseSelectors`. `null`
   * disables the sync — the collapsed dataset card asks for no cases.
   */
  useFetchTestCases = (params: TestCaseListParams | null): ReplicaSyncResult => {
    const datasetId = params?.datasetId;
    // Subscribe so a replica commit re-renders the consumer; the value itself is
    // read through the store below.
    useEvalStore((s) => (datasetId ? s.testCaseListMap[datasetId] : undefined));
    return this.#list.useSync(datasetId ? params : null);
  };
}

export type TestCaseAction = Pick<TestCaseActionImpl, keyof TestCaseActionImpl>;

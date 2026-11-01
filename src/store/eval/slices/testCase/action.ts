import {
  createReplicaSlice,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import { type EvalStore, useEvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  datasetIdOfPageKey,
  type TestCaseDetail,
  testCaseDetailResource,
  type TestCaseListQuery,
  testCaseListQueryKey,
  testCaseListResource,
  type TestCaseListValue,
} from './projection';

const n = setNamespace('evalTestCase');

type Setter = StoreSetter<EvalStore>;

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

/**
 * Where the case pages live, plus the dataset count derived from them.
 *
 * Every committed page — hydrated from storage or answered by the network —
 * refreshes its dataset's count in the SAME commit. Keeping it derived means a
 * page restored from IndexedDB publishes its cached total too; without that,
 * switching from a hydrated page to a page with no local copy yet would fall
 * back to a count nobody wrote and collapse the pager to 0.
 */
const testCasePageLens: ReplicaLens<EvalStore, TestCaseListValue> = {
  clear: () => ({ testCaseListMap: {}, testCaseTotalMap: {} }),
  get: (state, key) => state.testCaseListMap[key],
  keys: (state) => Object.keys(state.testCaseListMap),
  set: (state, key, data) => {
    const testCaseListMap = { ...state.testCaseListMap };
    let testCaseTotalMap = state.testCaseTotalMap;
    if (data === undefined) {
      delete testCaseListMap[key];
    } else {
      testCaseListMap[key] = data;
      const datasetId = datasetIdOfPageKey(key);
      if (datasetId) testCaseTotalMap = { ...testCaseTotalMap, [datasetId]: data.total };
    }
    return { testCaseListMap, testCaseTotalMap };
  },
};

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
    // - `#list`: the visited case pages → `testCaseListMap[pageKey]`, with the
    //   dataset counts derived into `testCaseTotalMap`
    // - `#detail`: a case addressed by id → `testCaseDetailMap[id]`
    this.#list = createReplicaSlice(testCaseListResource, {
      actionPrefix: n('testCaseList'),
      fetcher: ({ datasetId, limit, offset }) =>
        agentEvalService.listTestCases({ datasetId, limit, offset }),
      get,
      merge: (response) => ({ items: response.data, total: response.total }),
      set,
      stateKey: 'testCaseListReplica',
      view: testCasePageLens,
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

  refreshTestCaseDetail = async (id: string): Promise<void> => {
    await this.#detail.revalidate(id);
  };

  /**
   * Revalidate the loaded case pages. Pages are separate entries and a case
   * write can move rows across page boundaries, so every loaded page is
   * revalidated rather than only the one the caller happens to be looking at.
   */
  refreshTestCases = async (): Promise<void> => {
    await this.#list.revalidate();
  };

  /**
   * Edit a case definition in place. The dataset list is revalidated too: its
   * rows render the same input and expected answer, so leaving it alone shows a
   * stale row the moment you navigate back.
   */
  updateTestCase = async (
    id: string,
    data: {
      content?: { expected?: string; input?: string };
      evalConfig?: { criteria?: string };
    },
  ): Promise<void> => {
    await agentEvalService.updateTestCase({ id, ...data });
    await Promise.all([this.refreshTestCaseDetail(id), this.refreshTestCases()]);
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
   * Fetch orchestration only; read the rows with `testCaseSelectors.testCases(query)`.
   * `null` disables the sync — the collapsed dataset card asks for no cases.
   */
  useFetchTestCases = (query: TestCaseListQuery | null): ReplicaSyncResult => {
    // Subscribe so a replica commit re-renders the consumer; the rows themselves
    // are read through the selectors.
    useEvalStore((s) => (query ? s.testCaseListMap[testCaseListQueryKey(query)] : undefined));
    return this.#list.useSync(query?.datasetId ? query : null);
  };
}

export type TestCaseAction = Pick<TestCaseActionImpl, keyof TestCaseActionImpl>;

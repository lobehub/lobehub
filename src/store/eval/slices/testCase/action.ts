import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<EvalStore>;

export const createTestCaseSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new TestCaseActionImpl(set, get, _api);

export class TestCaseActionImpl {
  readonly #get: () => EvalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  getTestCaseById = (id: string): any | undefined => {
    return this.#get().testCaseDetailCache[id];
  };

  getTestCasesByDatasetId = (datasetId: string): any[] => {
    return this.#get().testCasesCache[datasetId]?.data || [];
  };

  getTestCasesTotalByDatasetId = (datasetId: string): number => {
    return this.#get().testCasesCache[datasetId]?.total || 0;
  };

  isLoadingTestCases = (datasetId: string): boolean => {
    return this.#get().loadingTestCaseIds.includes(datasetId);
  };

  refreshTestCases = async (datasetId: string): Promise<void> => {
    await mutate(
      (key) => Array.isArray(key) && key[0] === evalKeys.testCases.root && key[1] === datasetId,
    );
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
    await mutate(evalKeys.testCaseDetail(id));
    await this.refreshTestCases(datasetId);
  };

  /**
   * A test case on its own, not as a row of a dataset page — the case detail
   * route is reachable directly, so it cannot rely on the list being loaded.
   */
  useFetchTestCase = (id?: string): SWRResponse => {
    return useClientDataSWR(
      id ? evalKeys.testCaseDetail(id) : null,
      () => agentEvalService.getTestCase(id!),
      {
        onSuccess: (data: any) => {
          this.#set(
            (state) => ({
              testCaseDetailCache: { ...state.testCaseDetailCache, [data.id]: data },
            }),
            false,
            `useFetchTestCase/success/${id}`,
          );
        },
      },
    );
  };

  useFetchTestCases = (params: {
    datasetId: string;
    limit?: number;
    offset?: number;
  }): SWRResponse => {
    const { datasetId, limit = 10, offset = 0 } = params;

    return useClientDataSWR(
      datasetId ? evalKeys.testCases(datasetId, limit, offset) : null,
      () => agentEvalService.listTestCases({ datasetId, limit, offset }),
      {
        onSuccess: (data: any) => {
          this.#set(
            (state) => ({
              loadingTestCaseIds: state.loadingTestCaseIds.filter((id) => id !== datasetId),
              testCasesCache: {
                ...state.testCasesCache,
                [datasetId]: {
                  data: data.data,
                  pagination: { limit, offset },
                  total: data.total,
                },
              },
            }),
            false,
            `useFetchTestCases/success/${datasetId}`,
          );
        },
      },
    );
  };
}

export type TestCaseAction = Pick<TestCaseActionImpl, keyof TestCaseActionImpl>;

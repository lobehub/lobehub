import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';

const FETCH_TEST_CASES_KEY = 'FETCH_TEST_CASES';

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
      (key) => Array.isArray(key) && key[0] === FETCH_TEST_CASES_KEY && key[1] === datasetId,
    );
  };

  useFetchTestCases = (params: {
    datasetId: string;
    limit?: number;
    offset?: number;
  }): SWRResponse => {
    const { datasetId, limit = 10, offset = 0 } = params;

    return useClientDataSWR(
      datasetId ? [FETCH_TEST_CASES_KEY, datasetId, limit, offset] : null,
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

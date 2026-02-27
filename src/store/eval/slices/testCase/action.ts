import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';

const FETCH_TEST_CASES_KEY = 'FETCH_TEST_CASES';

export interface TestCaseAction {
  getTestCasesByDatasetId: (datasetId: string) => any[];
  getTestCasesTotalByDatasetId: (datasetId: string) => number;
  isLoadingTestCases: (datasetId: string) => boolean;
  refreshTestCases: (datasetId: string) => Promise<void>;
  useFetchTestCases: (params: {
    datasetId: string;
    limit?: number;
    offset?: number;
  }) => SWRResponse;
}

export const createTestCaseSlice: StateCreator<
  EvalStore,
  [['zustand/devtools', never]],
  [],
  TestCaseAction
> = (set, get) => ({
  // Get test cases for a specific dataset from cache
  getTestCasesByDatasetId: (datasetId) => {
    return get().testCasesCache[datasetId]?.data || [];
  },

  // Get total count for a specific dataset from cache
  getTestCasesTotalByDatasetId: (datasetId) => {
    return get().testCasesCache[datasetId]?.total || 0;
  },

  // Check if test cases are currently loading for a dataset
  isLoadingTestCases: (datasetId) => {
    return get().loadingTestCaseIds.includes(datasetId);
  },

  refreshTestCases: async (datasetId) => {
    // Mutate all SWR keys that start with [FETCH_TEST_CASES_KEY, datasetId]
    await mutate(
      (key) =>
        Array.isArray(key) && key[0] === FETCH_TEST_CASES_KEY && key[1] === datasetId,
    );
  },

  useFetchTestCases: (params) => {
    const { datasetId, limit = 10, offset = 0 } = params;

    return useClientDataSWR(
      datasetId ? [FETCH_TEST_CASES_KEY, datasetId, limit, offset] : null,
      () => agentEvalService.listTestCases({ datasetId, limit, offset }),
      {
        onSuccess: (data: any) => {
          set(
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
  },
});

interface TestCaseCacheItem {
  data: any[];
  pagination: { limit: number; offset: number };
  total: number;
}

export interface TestCaseSliceState {
  // Map to cache test cases by datasetId
  loadingTestCaseIds: string[];
  testCasesCache: Record<string, TestCaseCacheItem>;
}

export const testCaseInitialState: TestCaseSliceState = {
  loadingTestCaseIds: [],
  testCasesCache: {},
};

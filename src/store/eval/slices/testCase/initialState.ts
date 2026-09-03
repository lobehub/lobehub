interface TestCaseCacheItem {
  data: any[];
  pagination: { limit: number; offset: number };
  total: number;
}

export interface TestCaseSliceState {
  // Map to cache test cases by datasetId
  loadingTestCaseIds: string[];
  /** A single test case addressed by its own id, for the case detail page. */
  testCaseDetailCache: Record<string, any>;
  testCasesCache: Record<string, TestCaseCacheItem>;
}

export const testCaseInitialState: TestCaseSliceState = {
  loadingTestCaseIds: [],
  testCaseDetailCache: {},
  testCasesCache: {},
};

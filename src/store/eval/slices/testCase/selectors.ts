import type { EvalStore } from '@/store/eval/store';

import type { TestCaseListItem } from './projection';

/** Stable empty array so a selector never returns a fresh reference on every read. */
const EMPTY_TEST_CASES: TestCaseListItem[] = [];

/**
 * The dataset's case page has no local copy yet (`undefined` is the loading
 * signal) — the table / collapsible card keeps its skeleton until first paint.
 */
const isLoadingTestCases = (datasetId?: string) => (s: EvalStore) =>
  !!datasetId && s.testCaseListMap[datasetId] === undefined;

/** The rows of a dataset's current case page. */
const testCases = (datasetId?: string) => (s: EvalStore) =>
  (datasetId ? s.testCaseListMap[datasetId]?.items : undefined) ?? EMPTY_TEST_CASES;

/** The dataset's live case count, as the current page's response reported it. */
const testCaseTotal = (datasetId?: string) => (s: EvalStore) =>
  (datasetId ? s.testCaseListMap[datasetId]?.total : 0) ?? 0;

export const testCaseSelectors = {
  isLoadingTestCases,
  testCases,
  testCaseTotal,
};

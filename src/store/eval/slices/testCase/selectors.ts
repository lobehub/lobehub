import type { EvalStore } from '@/store/eval/store';

import { type TestCaseListItem, type TestCaseListQuery, testCaseListQueryKey } from './projection';

/** Stable empty array so a selector never returns a fresh reference on every read. */
const EMPTY_TEST_CASES: TestCaseListItem[] = [];

/**
 * The requested page has no local copy yet (`undefined` is the loading signal) —
 * the table / collapsible card keeps its skeleton until first paint. Every page
 * is its own entry, so a page whose request is still in flight (or failed) is
 * loading even while another page of the same dataset is cached.
 */
const isLoadingTestCases = (query?: TestCaseListQuery | null) => (s: EvalStore) =>
  !!query && s.testCaseListMap[testCaseListQueryKey(query)] === undefined;

/** The rows of the requested page. */
const testCases = (query?: TestCaseListQuery | null) => (s: EvalStore) =>
  (query ? s.testCaseListMap[testCaseListQueryKey(query)]?.items : undefined) ?? EMPTY_TEST_CASES;

/**
 * The dataset-wide case count. Every page response counts the whole dataset, so
 * the requested page's own value paints it first (a hydrated page included,
 * without waiting for the network); a page that has not loaded yet falls back to
 * the last count a response reported, which keeps the pager from collapsing.
 */
const testCaseTotal = (query?: TestCaseListQuery | null) => (s: EvalStore) => {
  if (!query) return 0;
  const page = s.testCaseListMap[testCaseListQueryKey(query)];
  return page?.total ?? s.testCaseTotalMap[query.datasetId] ?? 0;
};

export const testCaseSelectors = {
  isLoadingTestCases,
  testCases,
  testCaseTotal,
};

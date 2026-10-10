import type { EvalStore } from '@/store/eval/store';

import {
  type TestCaseListItem,
  type TestCaseListQuery,
  testCaseListResource,
  type TestCaseListValue,
} from './projection';

/** Stable empty array so a selector never returns a fresh reference on every read. */
const EMPTY_TEST_CASES: TestCaseListItem[] = [];

/**
 * The dataset's case page for exactly this query. The entry is keyed by
 * `datasetId` only, so while a new page is in flight (or after it failed) the
 * entry still holds the previous page; it is not this query's page and must
 * not be shown with the new pagination.
 */
const pageOf = (s: EvalStore, query?: TestCaseListQuery | null): TestCaseListValue | undefined => {
  if (!query?.datasetId) return undefined;
  const entry = s.testCaseListReplica.entries[query.datasetId];
  // A view seeded without bookkeeping has no query to compare against.
  if (entry && entry.query !== testCaseListResource.query(query)) return undefined;
  return s.testCaseListMap[query.datasetId];
};

/**
 * The requested case page has no local copy yet (`undefined` is the loading
 * signal) — the table / collapsible card keeps its skeleton until first paint.
 */
const isLoadingTestCases = (query?: TestCaseListQuery | null) => (s: EvalStore) =>
  !!query?.datasetId && pageOf(s, query) === undefined;

/** The rows of the requested case page. */
const testCases = (query?: TestCaseListQuery | null) => (s: EvalStore) =>
  pageOf(s, query)?.items ?? EMPTY_TEST_CASES;

/**
 * The dataset's live case count, as the latest page's response reported it.
 * The count is dataset-wide, so a previous page's total is still valid while
 * the next page loads (and keeps the pager from collapsing).
 */
const testCaseTotal = (datasetId?: string) => (s: EvalStore) =>
  (datasetId ? s.testCaseListMap[datasetId]?.total : 0) ?? 0;

export const testCaseSelectors = {
  isLoadingTestCases,
  testCases,
  testCaseTotal,
};

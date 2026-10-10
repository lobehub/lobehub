import { defineReplica, stableQueryKey } from '@/libs/replica';
import type { agentEvalService } from '@/services/agentEval';

type ListTestCasesResponse = Awaited<ReturnType<typeof agentEvalService.listTestCases>>;
type GetTestCaseResponse = Awaited<ReturnType<typeof agentEvalService.getTestCase>>;

/** A test case row as the case list returns it. */
export type TestCaseListItem = ListTestCasesResponse['data'][number];
/** The single case the detail route renders; `getTestCase` returns the row itself. */
export type TestCaseDetail = GetTestCaseResponse;

/** Everything that decides which case rows a page holds. */
export interface TestCaseListQuery {
  datasetId: string;
  limit?: number;
  offset?: number;
}

export interface TestCaseListValue {
  items: TestCaseListItem[];
  total: number;
}

/**
 * Entry key of one page: the whole query, not just the dataset. A dataset view
 * shows a single page at a time, but every visited page keeps its own entry —
 * and its own persisted row — so returning to a page paints its cached rows
 * again instead of leaving the table empty until the network answers.
 */
export const testCaseListQueryKey = (query: TestCaseListQuery) => stableQueryKey(query);

export const testCaseListResource = defineReplica<
  TestCaseListQuery,
  TestCaseListValue,
  ListTestCasesResponse
>({
  key: testCaseListQueryKey,
  name: 'evalTestCaseList',
  storage: 'indexedDB',
  version: 1,
});

/** By-id test-case detail cache (`testCaseDetailMap[id]`). */
export const testCaseDetailResource = defineReplica<string, TestCaseDetail, GetTestCaseResponse>({
  key: (id) => id,
  name: 'evalTestCaseDetail',
  storage: 'indexedDB',
  version: 1,
});

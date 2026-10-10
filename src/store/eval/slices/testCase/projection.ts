import { defineReplica } from '@/libs/replica';
import type { agentEvalService } from '@/services/agentEval';

type ListTestCasesResponse = Awaited<ReturnType<typeof agentEvalService.listTestCases>>;
type GetTestCaseResponse = Awaited<ReturnType<typeof agentEvalService.getTestCase>>;

/** A test case row as the dataset's case list returns it. */
export type TestCaseListItem = ListTestCasesResponse['data'][number];
/** The single case the detail route renders; `getTestCase` returns the row itself. */
export type TestCaseDetail = GetTestCaseResponse;

/**
 * Which page of a dataset's cases a view holds. `datasetId` is the entry key —
 * a dataset view shows one page at a time — while `limit` / `offset` are the
 * entry's query, so each page is persisted under its own row and switching
 * pages never paints a superseded one.
 */
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
 * One dataset's case page (`testCaseListMap[datasetId]`). The same endpoint
 * serves the dataset detail page and the benchmark's dataset cards, but each
 * dataset is its own entry, so the two never share — or reset — one page.
 */
export const testCaseListResource = defineReplica<
  TestCaseListQuery,
  TestCaseListValue,
  ListTestCasesResponse
>({
  key: ({ datasetId }) => datasetId,
  name: 'evalTestCaseList',
  query: ({ limit, offset }) => ({ limit: limit ?? 0, offset: offset ?? 0 }),
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

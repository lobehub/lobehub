import { defineReplica } from '@/libs/replica';
import type { agentEvalService } from '@/services/agentEval';

type BenchmarkListResponse = Awaited<ReturnType<typeof agentEvalService.listBenchmarks>>;
type BenchmarkDetailResponse = Awaited<ReturnType<typeof agentEvalService.getBenchmark>>;

/** A benchmark row as any loaded list holds it (list columns + computed counts). */
export type BenchmarkListItem = BenchmarkListResponse[number];
/** One benchmark page — the full row the detail page renders. */
export type BenchmarkDetail = BenchmarkDetailResponse;

/**
 * The benchmark list has one entry per cache scope: there are no query params,
 * so the overview, the sidebar and the header switcher all read the same list.
 */
export const BENCHMARK_LIST_KEY = 'all';

/** Every benchmark of the active scope (the flat `benchmarkList` view). */
export const benchmarkListResource = defineReplica<
  Record<string, never>,
  BenchmarkListItem[],
  BenchmarkListResponse
>({
  key: () => BENCHMARK_LIST_KEY,
  name: 'evalBenchmarkList',
  storage: 'indexedDB',
  version: 1,
});

/** One benchmark page, keyed by the route param (`benchmarkDetailMap[id]`). */
export const benchmarkDetailResource = defineReplica<
  string,
  BenchmarkDetail,
  BenchmarkDetailResponse
>({
  key: (id) => id,
  name: 'evalBenchmarkDetail',
  storage: 'indexedDB',
  version: 1,
});

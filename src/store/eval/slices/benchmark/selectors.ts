import type { EvalStore } from '@/store/eval/store';

const benchmarkList = (s: EvalStore) => s.benchmarkList;
const isBenchmarkListInit = (s: EvalStore) => s.benchmarkListInit;
const isLoadingBenchmarkList = (s: EvalStore) => s.isLoadingBenchmarkList;
const isCreatingBenchmark = (s: EvalStore) => s.isCreatingBenchmark;
const getBenchmarkById = (id: string) => (s: EvalStore) =>
  s.benchmarkList.find((b: any) => b.id === id);

export const benchmarkSelectors = {
  benchmarkList,
  getBenchmarkById,
  isBenchmarkListInit,
  isCreatingBenchmark,
  isLoadingBenchmarkList,
};

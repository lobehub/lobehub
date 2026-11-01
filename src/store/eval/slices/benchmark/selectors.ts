import type { EvalStore } from '@/store/eval/store';

const benchmarkList = (s: EvalStore) => s.benchmarkList;
const isBenchmarkListInit = (s: EvalStore) => s.benchmarkListInit;
const getBenchmarkById = (id: string) => (s: EvalStore) => s.benchmarkList.find((b) => b.id === id);

export const benchmarkSelectors = {
  benchmarkList,
  getBenchmarkById,
  isBenchmarkListInit,
};

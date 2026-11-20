import { isLobeBenchKind } from '@/store/eval/kinds';
import type { EvalStore } from '@/store/eval/store';

const benchmarkList = (s: EvalStore) => s.benchmarkList;
/** The Evaluation Lab's benchmarks: everything that is not Lobe Bench's. */
const agentBenchmarkList = (s: EvalStore) => s.benchmarkList.filter((b) => !isLobeBenchKind(b));
const isBenchmarkListInit = (s: EvalStore) => s.benchmarkListInit;
const getBenchmarkById = (id: string) => (s: EvalStore) => s.benchmarkList.find((b) => b.id === id);

export const benchmarkSelectors = {
  agentBenchmarkList,
  benchmarkList,
  getBenchmarkById,
  isBenchmarkListInit,
};

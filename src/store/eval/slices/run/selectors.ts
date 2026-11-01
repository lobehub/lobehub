import type { AgentEvalRunListItem } from '@lobechat/types';

import type { EvalStore } from '@/store/eval/store';

/** Stable empty array so a selector never returns a fresh reference on every read. */
const EMPTY_RUNS: AgentEvalRunListItem[] = [];

const runList = (benchmarkId?: string) => (s: EvalStore) =>
  (benchmarkId ? s.runListMap[benchmarkId] : undefined) ?? EMPTY_RUNS;

const datasetRunList = (datasetId: string) => (s: EvalStore) =>
  s.datasetRunListMap[datasetId] ?? EMPTY_RUNS;

const isCreatingRun = (s: EvalStore) => s.isCreatingRun;

/**
 * The benchmark run list has no local copy yet (`undefined` is the loading
 * signal) — the sidebar / RunsTab keep their skeleton until the first paint.
 */
const isLoadingRuns = (benchmarkId?: string) => (s: EvalStore) =>
  !!benchmarkId && s.runListMap[benchmarkId] === undefined;

const getRunDetailById = (id: string) => (s: EvalStore) => s.runDetailMap[id];
const getRunResultsById = (id: string) => (s: EvalStore) => s.runResultsMap[id];

const isRunActive = (id: string) => (s: EvalStore) => {
  const run = s.runDetailMap[id];
  return run?.status === 'running' || run?.status === 'pending';
};

export const runSelectors = {
  datasetRunList,
  getRunDetailById,
  getRunResultsById,
  isCreatingRun,
  isLoadingRuns,
  isRunActive,
  runList,
};

import type { EvalStore } from '@/store/eval/store';

const runList = (s: EvalStore) => s.runList;
const datasetRunList = (datasetId: string) => (s: EvalStore) =>
  s.datasetRunListMap[datasetId] || [];
const isCreatingRun = (s: EvalStore) => s.isCreatingRun;
const isLoadingRuns = (s: EvalStore) => s.isLoadingRuns;

const getRunDetailById = (id: string) => (s: EvalStore) => s.runDetailMap[id];
const getRunResultsById = (id: string) => (s: EvalStore) => s.runResultsMap[id];

const isLoadingRunDetail = (id: string) => (s: EvalStore) => s.loadingRunDetailIds.includes(id);
const isLoadingRunResults = (id: string) => (s: EvalStore) => s.loadingRunResultIds.includes(id);

const isRunActive = (id: string) => (s: EvalStore) => {
  const run = s.runDetailMap[id];
  return run?.status === 'running' || run?.status === 'pending';
};

export const runSelectors = {
  datasetRunList,
  getRunDetailById,
  getRunResultsById,
  isCreatingRun,
  isLoadingRunDetail,
  isLoadingRunResults,
  isLoadingRuns,
  isRunActive,
  runList,
};

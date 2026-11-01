import type { EvalStore } from '@/store/eval/store';

const experimentList = (s: EvalStore) => s.experimentList;
const isExperimentListInit = (s: EvalStore) => s.experimentListInit;
const getExperimentDetailById = (id: string) => (s: EvalStore) => s.experimentDetailMap[id];

export const experimentSelectors = {
  experimentList,
  getExperimentDetailById,
  isExperimentListInit,
};

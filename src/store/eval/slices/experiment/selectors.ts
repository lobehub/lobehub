import { isLobeBenchKind } from '@/store/eval/kinds';
import type { EvalStore } from '@/store/eval/store';

const experimentList = (s: EvalStore) => s.experimentList;
/** The Evaluation Lab's experiments: everything that is not Lobe Bench's. */
const agentExperimentList = (s: EvalStore) =>
  s.experimentList.filter((experiment) => !isLobeBenchKind(experiment));
const isExperimentListInit = (s: EvalStore) => s.experimentListInit;
const getExperimentDetailById = (id: string) => (s: EvalStore) => s.experimentDetailMap[id];

export const experimentSelectors = {
  agentExperimentList,
  experimentList,
  getExperimentDetailById,
  isExperimentListInit,
};

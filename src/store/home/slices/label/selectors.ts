import { type AgentLabelListItem } from '@lobechat/types';

import { type HomeStoreState } from '@/store/home/initialState';

const allLabels = (s: HomeStoreState): AgentLabelListItem[] => s.agentLabels;

/** Labels that can still be applied — archived ones are picker-hidden. */
const activeLabels = (s: HomeStoreState): AgentLabelListItem[] =>
  s.agentLabels.filter((label) => !label.archived);

const archivedLabels = (s: HomeStoreState): AgentLabelListItem[] =>
  s.agentLabels.filter((label) => label.archived);

const getLabelById =
  (id: string) =>
  (s: HomeStoreState): AgentLabelListItem | undefined =>
    s.agentLabels.find((label) => label.id === id);

const isLabelsInit = (s: HomeStoreState): boolean => s.isAgentLabelsInit;

export const agentLabelSelectors = {
  activeLabels,
  allLabels,
  archivedLabels,
  getLabelById,
  isLabelsInit,
};

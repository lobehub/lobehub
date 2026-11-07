import type { TaskLabelWithUsage } from '@lobechat/types';

import type { TaskStoreState } from '../initialState';

const EMPTY: TaskLabelWithUsage[] = [];

const labels = (s: TaskStoreState) => (s.taskLabelsInit ? s.taskLabels : EMPTY);
const isLabelsInit = (s: TaskStoreState) => s.taskLabelsInit;
const labelGroups = (s: TaskStoreState) => labels(s).filter((label) => label.isGroup);
const labelById = (id: string | null | undefined) => (s: TaskStoreState) =>
  id ? labels(s).find((label) => label.id === id) : undefined;

export const taskLabelSelectors = {
  isLabelsInit,
  labelById,
  labelGroups,
  labels,
};

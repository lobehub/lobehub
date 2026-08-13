import type { TaskStoreState } from '../initialState';

const listVisibility = (s: TaskStoreState) => s.listVisibility;

export const taskListSelectors = {
  listVisibility,
  viewMode,
};

import type { TaskStoreState } from '../initialState';

const listVisibility = (s: TaskStoreState) => s.listVisibility;
const viewMode = (s: TaskStoreState) => s.viewMode;

export const taskListSelectors = {
  listVisibility,
  viewMode,
};

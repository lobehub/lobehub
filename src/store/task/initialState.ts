import type { TaskDetailSliceState } from './slices/detail/initialState';
import { initialTaskDetailSliceState } from './slices/detail/initialState';
import type { TaskLabelSliceState } from './slices/label/initialState';
import { initialTaskLabelSliceState } from './slices/label/initialState';
import type { TaskListSliceState } from './slices/list/initialState';
import { initialTaskListSliceState } from './slices/list/initialState';

export type TaskStoreState = TaskDetailSliceState & TaskLabelSliceState & TaskListSliceState;

export const initialState: TaskStoreState = {
  ...initialTaskListSliceState,
  ...initialTaskDetailSliceState,
  ...initialTaskLabelSliceState,
};

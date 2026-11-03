import type { TaskDetailSliceState } from './slices/detail/initialState';
import { initialTaskDetailSliceState } from './slices/detail/initialState';
import type { TaskListSliceState } from './slices/list/initialState';
import { initialTaskListSliceState } from './slices/list/initialState';

export type TaskStoreState = TaskDetailSliceState & TaskListSliceState;

export const initialState: TaskStoreState = {
  ...initialTaskListSliceState,
  ...initialTaskDetailSliceState,
};

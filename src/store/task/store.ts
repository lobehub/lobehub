import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import type { TaskStoreState } from './initialState';
import { initialState } from './initialState';
import type { TaskConfigSliceAction } from './slices/config';
import { createTaskConfigSlice } from './slices/config';
import type { TaskDetailSliceAction } from './slices/detail';
import { createTaskDetailSlice } from './slices/detail';
import type { TaskLifecycleSliceAction } from './slices/lifecycle';
import { createTaskLifecycleSlice } from './slices/lifecycle';
import type { TaskListSliceAction } from './slices/list';
import { createTaskListSlice } from './slices/list';

//  ===============  aggregate createStoreFn ============ //

export interface TaskStore
  extends
    TaskConfigSliceAction,
    TaskDetailSliceAction,
    TaskLifecycleSliceAction,
    TaskListSliceAction,
    TaskStoreState {}

type TaskStoreAction = TaskConfigSliceAction &
  TaskDetailSliceAction &
  TaskLifecycleSliceAction &
  TaskListSliceAction;

const createStore: StateCreator<TaskStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<TaskStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<TaskStoreAction>([
    createTaskListSlice(...parameters),
    createTaskDetailSlice(...parameters),
    createTaskLifecycleSlice(...parameters),
    createTaskConfigSlice(...parameters),
  ]),
});

//  ===============  implement useStore ============ //

const devtools = createDevtools('task');

export const useTaskStore = createWithEqualityFn<TaskStore>()(devtools(createStore), shallow);

expose('task', useTaskStore);

export const getTaskStoreState = () => useTaskStore.getState();

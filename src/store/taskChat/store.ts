import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { createTaskChatSlice, type TaskChatAction } from './action';
import { initialState, type TaskChatState } from './initialState';

export type TaskChatStore = TaskChatState & TaskChatAction & ResetableStore;

type TaskChatStoreAction = TaskChatAction & ResetableStore;

class TaskChatResetAction extends ResetableStoreAction<TaskChatStore> {
  protected readonly resetActionName = 'resetTaskChatStore';
}

const createStore: StateCreator<TaskChatStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<TaskChatStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<TaskChatStoreAction>([
    createTaskChatSlice(...parameters),
    new TaskChatResetAction(...parameters),
  ]),
});

const devtools = createDevtools('taskChat');

export const useTaskChatStore = createWithEqualityFn<TaskChatStore>()(
  devtools(createStore),
  shallow,
);

expose('taskChat', useTaskChatStore);

export const getTaskChatStoreState = () => useTaskChatStore.getState();

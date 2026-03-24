import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type NotebookAction } from './action';
import { createNotebookAction } from './action';
import { type NotebookState } from './initialState';
import { initialNotebookState } from './initialState';

export type NotebookStore = NotebookState & NotebookAction;

const createStore: StateCreator<NotebookStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<NotebookStore, [['zustand/devtools', never]]>>
) => ({
  ...initialNotebookState,
  ...flattenActions<NotebookAction>([createNotebookAction(...parameters)]),
});

const devtools = createDevtools('notebook');

export const useNotebookStore = createWithEqualityFn<NotebookStore>()(
  devtools(createStore),
  shallow,
);

expose('notebook', useNotebookStore);

export const getNotebookStoreState = () => useNotebookStore.getState();

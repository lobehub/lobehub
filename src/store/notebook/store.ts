import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type NotebookAction, createNotebookAction } from './action';
import { type NotebookState, initialNotebookState } from './initialState';

export type NotebookStore = NotebookState & NotebookAction;

const createStore: StateCreator<NotebookStore, [['zustand/devtools', never]]> = (
  ...parameters
) => ({
  ...initialNotebookState,
  ...createNotebookAction(...parameters),
});

const devtools = createDevtools('notebook');

export const useNotebookStore = createWithEqualityFn<NotebookStore>()(
  devtools(createStore),
  shallow,
);

export const getNotebookStoreState = () => useNotebookStore.getState();

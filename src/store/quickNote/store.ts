import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { createQuickNoteSlice, type QuickNoteAction } from './action';
import { initialState, type QuickNoteState } from './initialState';

export type QuickNoteStore = QuickNoteState & QuickNoteAction;

const createStore: StateCreator<QuickNoteStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<QuickNoteStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<QuickNoteAction>([createQuickNoteSlice(...parameters)]),
});

const devtools = createDevtools('quickNote');

export const useQuickNoteStore = createWithEqualityFn<QuickNoteStore>()(
  devtools(createStore),
  shallow,
);

expose('quickNote', useQuickNoteStore);

export const getQuickNoteStoreState = () => useQuickNoteStore.getState();

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { createQuickNoteSlice, type QuickNoteStoreAction } from './action';
import { initialState, type QuickNoteState } from './initialState';
import { createQuickNoteProposalSlice } from './proposalAction';

export type QuickNoteStore = QuickNoteState & QuickNoteStoreAction;

const createStore: StateCreator<QuickNoteStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<QuickNoteStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<QuickNoteStoreAction>([
    createQuickNoteSlice(...parameters),
    createQuickNoteProposalSlice(...parameters),
  ]),
});

const devtools = createDevtools('quickNote');

export const useQuickNoteStore = createWithEqualityFn<QuickNoteStore>()(
  devtools(createStore),
  shallow,
);

expose('quickNote', useQuickNoteStore);

export const getQuickNoteStoreState = () => useQuickNoteStore.getState();

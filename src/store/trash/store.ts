import { devtools } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { type TrashAction, trashSlice } from './action';
import { initialState, type TrashState } from './initialState';

export interface TrashStore extends TrashState, TrashAction {
  /* empty */
}

const createStore: StateCreator<TrashStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...trashSlice(...parameters),
});

export const useTrashStore = createWithEqualityFn<TrashStore>()(
  devtools(createStore, { name: 'trash' }),
  shallow,
);

export const getTrashStoreState = () => useTrashStore.getState();

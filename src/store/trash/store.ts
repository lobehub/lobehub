import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type TrashAction, trashSlice } from './action';
import { initialState, type TrashState } from './initialState';

export interface TrashStore extends TrashState, TrashAction {
  /* empty */
}

const createStore: StateCreator<TrashStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...flattenActions<TrashAction>([trashSlice(...parameters)]),
});

const devtools = createDevtools('trash');

export const useTrashStore = createWithEqualityFn<TrashStore>()(devtools(createStore), shallow);

expose('trash', useTrashStore);

export const getTrashStoreState = () => useTrashStore.getState();

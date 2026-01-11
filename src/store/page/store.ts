import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type PageState, initialState } from './initialState';
import { type CrudAction, createCrudSlice } from './slices/crud';
import { type InternalAction, createInternalSlice } from './slices/internal';
import { type ListAction, createListSlice } from './slices/list';
import { type SelectionAction, createSelectionSlice } from './slices/selection';

//  ===============  Aggregate createStoreFn ============ //

export type PageStore = PageState & InternalAction & ListAction & SelectionAction & CrudAction;

const createStore: StateCreator<PageStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...createInternalSlice(...parameters),
  ...createListSlice(...parameters),
  ...createSelectionSlice(...parameters),
  ...createCrudSlice(...parameters),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('page');

export const usePageStore = createWithEqualityFn<PageStore>()(devtools(createStore), shallow);

export const getPageStoreState = () => usePageStore.getState();

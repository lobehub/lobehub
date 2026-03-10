import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type PageState } from './initialState';
import { initialState } from './initialState';
import { type CrudAction } from './slices/crud';
import { createCrudSlice } from './slices/crud';
import { type InternalAction } from './slices/internal';
import { createInternalSlice } from './slices/internal';
import { type ListAction } from './slices/list';
import { createListSlice } from './slices/list';
import { type SelectionAction } from './slices/selection';
import { createSelectionSlice } from './slices/selection';

//  ===============  Aggregate createStoreFn ============ //

export type PageStore = PageState & InternalAction & ListAction & SelectionAction & CrudAction;

type PageStoreAction = InternalAction & ListAction & SelectionAction & CrudAction;

const createStore: StateCreator<PageStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<PageStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<PageStoreAction>([
    createInternalSlice(...parameters),
    createListSlice(...parameters),
    createSelectionSlice(...parameters),
    createCrudSlice(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('page');

export const usePageStore = createWithEqualityFn<PageStore>()(devtools(createStore), shallow);

export const getPageStoreState = () => usePageStore.getState();

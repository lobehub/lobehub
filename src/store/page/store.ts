import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
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

export type PageStore = PageState &
  InternalAction &
  ListAction &
  SelectionAction &
  CrudAction &
  ResetableStore;

type PageStoreAction = InternalAction & ListAction & SelectionAction & CrudAction & ResetableStore;

class PageStoreResetAction extends ResetableStoreAction<PageStore> {
  protected readonly resetActionName = 'resetPageStore';
}

const createStore: StateCreator<PageStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<PageStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<PageStoreAction>([
    createInternalSlice(...parameters),
    createListSlice(...parameters),
    createSelectionSlice(...parameters),
    createCrudSlice(...parameters),
    new PageStoreResetAction(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('page');

export const usePageStore = createWithEqualityFn<PageStore>()(devtools(createStore), shallow);

expose('page', usePageStore);

export const getPageStoreState = () => usePageStore.getState();

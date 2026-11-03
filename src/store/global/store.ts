import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type GlobalGeneralAction } from './actions/general';
import { generalActionSlice } from './actions/general';
import { type GlobalWorkspacePaneAction } from './actions/workspacePane';
import { globalWorkspaceSlice } from './actions/workspacePane';
import { createNavigationRef, type GlobalState, initialState } from './initialState';

//  ===============  Aggregate createStoreFn ============ //

export interface GlobalStore extends GlobalState, GlobalWorkspacePaneAction, GlobalGeneralAction {
  /* empty */
}

type GlobalStoreAction = GlobalWorkspacePaneAction & GlobalGeneralAction;

const createStore: StateCreator<GlobalStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<GlobalStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  // Own ref instance so nested `.current` writes never mutate exported `initialState.navigationRef`
  navigationRef: createNavigationRef(),
  ...flattenActions<GlobalStoreAction>([
    globalWorkspaceSlice(...parameters),
    generalActionSlice(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('global');

export const useGlobalStore = createWithEqualityFn<GlobalStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

expose('global', useGlobalStore);

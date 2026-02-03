import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type GlobalGeneralAction, generalActionSlice } from './actions/general';
import { type GlobalWorkspacePaneAction, globalWorkspaceSlice } from './actions/workspacePane';
import { type GlobalState, initialState } from './initialState';

//  ===============  Aggregate createStoreFn ============ //

export interface GlobalStore extends GlobalState, GlobalWorkspacePaneAction, GlobalGeneralAction {
  /* empty */
}

type GlobalStoreAction = GlobalWorkspacePaneAction & GlobalGeneralAction;

const createStore: StateCreator<GlobalStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<GlobalStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
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

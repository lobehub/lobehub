import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type ElectronAppAction, createElectronAppSlice } from './actions/app';
import {
  type NavigationHistoryAction,
  createNavigationHistorySlice,
} from './actions/navigationHistory';
import { type RecentPagesAction, createRecentPagesSlice } from './actions/recentPages';
import { type ElectronSettingsAction, settingsSlice } from './actions/settings';
import { type ElectronRemoteServerAction, remoteSyncSlice } from './actions/sync';
import { type ElectronState, initialState } from './initialState';

//  ===============  Aggregate createStoreFn ============ //

export interface ElectronStore
  extends
    ElectronState,
    ElectronRemoteServerAction,
    ElectronAppAction,
    ElectronSettingsAction,
    NavigationHistoryAction,
    RecentPagesAction {
  /* empty */
}

type ElectronStoreAction = ElectronRemoteServerAction &
  ElectronAppAction &
  ElectronSettingsAction &
  NavigationHistoryAction &
  RecentPagesAction;

const createStore: StateCreator<ElectronStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<ElectronStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<ElectronStoreAction>([
    remoteSyncSlice(...parameters),
    createElectronAppSlice(...parameters),
    settingsSlice(...parameters),
    createNavigationHistorySlice(...parameters),
    createRecentPagesSlice(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('electron');

export const useElectronStore = createWithEqualityFn<ElectronStore>()(
  devtools(createStore),
  shallow,
);

export const getElectronStoreState = () => useElectronStore.getState();

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type ElectronAppAction } from './actions/app';
import { createElectronAppSlice } from './actions/app';
import { type NavigationHistoryAction } from './actions/navigationHistory';
import { createNavigationHistorySlice } from './actions/navigationHistory';
import { type RecentPagesAction } from './actions/recentPages';
import { createRecentPagesSlice } from './actions/recentPages';
import { type ElectronSettingsAction } from './actions/settings';
import { settingsSlice } from './actions/settings';
import { type ElectronRemoteServerAction } from './actions/sync';
import { remoteSyncSlice } from './actions/sync';
import { type ElectronState } from './initialState';
import { initialState } from './initialState';

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

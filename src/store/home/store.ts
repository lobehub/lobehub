import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { isDev } from '@/utils/env';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type HomeStoreState } from './initialState';
import { initialState } from './initialState';
import { type AgentListAction } from './slices/agentList/action';
import { createAgentListSlice } from './slices/agentList/action';
import { type GroupAction } from './slices/group/action';
import { createGroupSlice } from './slices/group/action';
import { type HomeInputAction } from './slices/homeInput/action';
import { createHomeInputSlice } from './slices/homeInput/action';
import { type RecentAction } from './slices/recent/action';
import { createRecentSlice } from './slices/recent/action';
import { type SidebarUIAction } from './slices/sidebarUI/action';
import { createSidebarUISlice } from './slices/sidebarUI/action';

//  ===============  Aggregate createStoreFn ============ //

export interface HomeStore
  extends
    AgentListAction,
    GroupAction,
    RecentAction,
    HomeInputAction,
    SidebarUIAction,
    HomeStoreState {}

type HomeStoreAction = AgentListAction &
  GroupAction &
  RecentAction &
  HomeInputAction &
  SidebarUIAction;

const createStore: StateCreator<HomeStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<HomeStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<HomeStoreAction>([
    createAgentListSlice(...parameters),
    createGroupSlice(...parameters),
    createRecentSlice(...parameters),
    createHomeInputSlice(...parameters),
    createSidebarUISlice(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('home');

export const useHomeStore = createWithEqualityFn<HomeStore>()(
  subscribeWithSelector(
    devtools(createStore, {
      name: 'LobeChat_Home' + (isDev ? '_DEV' : ''),
    }),
  ),
  shallow,
);

export const getHomeStoreState = () => useHomeStore.getState();

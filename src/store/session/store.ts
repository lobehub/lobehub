import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { isDev } from '@/utils/env';

import { createDevtools } from '../middleware/createDevtools';
import { type SessionStoreState, initialState } from './initialState';
import { type HomeInputAction, createHomeInputSlice } from './slices/homeInput/action';
import { type RecentAction, createRecentSlice } from './slices/recent/action';
import { type SessionAction, createSessionSlice } from './slices/session/action';
import { type SessionGroupAction, createSessionGroupSlice } from './slices/sessionGroup/action';

//  ===============  Aggregate createStoreFn ============ //

export interface SessionStore
  extends SessionAction, SessionGroupAction, RecentAction, HomeInputAction, SessionStoreState {}

const createStore: StateCreator<SessionStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...createSessionSlice(...parameters),
  ...createSessionGroupSlice(...parameters),
  ...createRecentSlice(...parameters),
  ...createHomeInputSlice(...parameters),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('session');

export const useSessionStore = createWithEqualityFn<SessionStore>()(
  subscribeWithSelector(
    devtools(createStore, {
      name: 'LobeChat_Session' + (isDev ? '_DEV' : ''),
    }),
  ),
  shallow,
);

export const getSessionStoreState = () => useSessionStore.getState();

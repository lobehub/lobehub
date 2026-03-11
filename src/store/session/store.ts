import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { isDev } from '@/utils/env';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type SessionStoreState } from './initialState';
import { initialState } from './initialState';
import { type HomeInputAction } from './slices/homeInput/action';
import { createHomeInputSlice } from './slices/homeInput/action';
import { type RecentAction } from './slices/recent/action';
import { createRecentSlice } from './slices/recent/action';
import { type SessionAction } from './slices/session/action';
import { createSessionSlice } from './slices/session/action';
import { type SessionGroupAction } from './slices/sessionGroup/action';
import { createSessionGroupSlice } from './slices/sessionGroup/action';

//  ===============  Aggregate createStoreFn ============ //

export interface SessionStore
  extends SessionAction, SessionGroupAction, RecentAction, HomeInputAction, SessionStoreState {}

type SessionStoreAction = SessionAction & SessionGroupAction & RecentAction & HomeInputAction;

const createStore: StateCreator<SessionStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<SessionStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<SessionStoreAction>([
    createSessionSlice(...parameters),
    createSessionGroupSlice(...parameters),
    createRecentSlice(...parameters),
    createHomeInputSlice(...parameters),
  ]),
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

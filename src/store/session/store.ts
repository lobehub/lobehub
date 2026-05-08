import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { isDev } from '@/utils/env';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { type SessionStoreState } from './initialState';
import { initialState } from './initialState';
import { type SessionAction } from './slices/session/action';
import { createSessionSlice } from './slices/session/action';
import { type SessionGroupAction } from './slices/sessionGroup/action';
import { createSessionGroupSlice } from './slices/sessionGroup/action';

//  ===============  Aggregate createStoreFn ============ //

export interface SessionStore
  extends SessionAction, SessionGroupAction, ResetableStore, SessionStoreState {}

type SessionStoreAction = SessionAction & SessionGroupAction & ResetableStore;

class SessionStoreResetAction extends ResetableStoreAction<SessionStore> {
  protected readonly resetActionName = 'resetSessionStore';
}

const createStore: StateCreator<SessionStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<SessionStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<SessionStoreAction>([
    createSessionSlice(...parameters),
    createSessionGroupSlice(...parameters),
    new SessionStoreResetAction(...parameters),
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

expose('session', useSessionStore);

export const getSessionStoreState = () => useSessionStore.getState();

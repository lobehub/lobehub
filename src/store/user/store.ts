import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { type UserState } from './initialState';
import { initialState } from './initialState';
import { type AgentOnboardingAction } from './slices/agentOnboarding/action';
import { createAgentOnboardingSlice } from './slices/agentOnboarding/action';
import { type UserAuthAction } from './slices/auth/action';
import { createAuthSlice } from './slices/auth/action';
import { type CommonAction } from './slices/common/action';
import { createCommonSlice } from './slices/common/action';
import { type OnboardingAction } from './slices/onboarding/action';
import { createOnboardingSlice } from './slices/onboarding/action';
import { type PreferenceAction } from './slices/preference/action';
import { createPreferenceSlice } from './slices/preference/action';
import { type UserSettingsAction } from './slices/settings/action';
import { createSettingsSlice } from './slices/settings/action';

//  ===============  Aggregate createStoreFn ============ //

export type UserStore = UserState &
  UserSettingsAction &
  PreferenceAction &
  UserAuthAction &
  CommonAction &
  AgentOnboardingAction &
  OnboardingAction &
  ResetableStore;

type UserStoreAction = UserSettingsAction &
  PreferenceAction &
  UserAuthAction &
  CommonAction &
  AgentOnboardingAction &
  OnboardingAction &
  ResetableStore;

class UserStoreResetAction extends ResetableStoreAction<UserStore> {
  protected readonly resetActionName = 'resetUserStore';
}

const createStore: StateCreator<UserStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<UserStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<UserStoreAction>([
    createSettingsSlice(...parameters),
    createPreferenceSlice(...parameters),
    createAuthSlice(...parameters),
    createCommonSlice(...parameters),
    createAgentOnboardingSlice(...parameters),
    createOnboardingSlice(...parameters),
    new UserStoreResetAction(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('user');

export const useUserStore = createWithEqualityFn<UserStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

expose('user', useUserStore);

export const getUserStoreState = () => useUserStore.getState();

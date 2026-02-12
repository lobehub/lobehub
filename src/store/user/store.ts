import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type UserState } from './initialState';
import { initialState } from './initialState';
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
  OnboardingAction;

type UserStoreAction = UserSettingsAction &
  PreferenceAction &
  UserAuthAction &
  CommonAction &
  OnboardingAction;

const createStore: StateCreator<UserStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<UserStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<UserStoreAction>([
    createSettingsSlice(...parameters),
    createPreferenceSlice(...parameters),
    createAuthSlice(...parameters),
    createCommonSlice(...parameters),
    createOnboardingSlice(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('user');

export const useUserStore = createWithEqualityFn<UserStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

export const getUserStoreState = () => useUserStore.getState();

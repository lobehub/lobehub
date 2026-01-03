import { type UserAuthState, initialAuthState } from './slices/auth/initialState';
import { type CommonState, initialCommonState } from './slices/common/initialState';
import { type OnboardingState, initialOnboardingState } from './slices/onboarding/initialState';
import { type UserPreferenceState, initialPreferenceState } from './slices/preference/initialState';
import { type UserSettingsState, initialSettingsState } from './slices/settings/initialState';

export type UserState = UserSettingsState &
  UserPreferenceState &
  UserAuthState &
  CommonState &
  OnboardingState;

export const initialState: UserState = {
  ...initialSettingsState,
  ...initialPreferenceState,
  ...initialAuthState,
  ...initialCommonState,
  ...initialOnboardingState,
};

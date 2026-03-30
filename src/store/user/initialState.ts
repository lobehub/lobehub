import { type AgentOnboardingState } from './slices/agentOnboarding/initialState';
import { initialAgentOnboardingState } from './slices/agentOnboarding/initialState';
import { type UserAuthState } from './slices/auth/initialState';
import { initialAuthState } from './slices/auth/initialState';
import { type CommonState } from './slices/common/initialState';
import { initialCommonState } from './slices/common/initialState';
import { type OnboardingState } from './slices/onboarding/initialState';
import { initialOnboardingState } from './slices/onboarding/initialState';
import { type UserPreferenceState } from './slices/preference/initialState';
import { initialPreferenceState } from './slices/preference/initialState';
import { type UserSettingsState } from './slices/settings/initialState';
import { initialSettingsState } from './slices/settings/initialState';

export type UserState = UserSettingsState &
  UserPreferenceState &
  UserAuthState &
  CommonState &
  AgentOnboardingState &
  OnboardingState;

export const initialState: UserState = {
  ...initialSettingsState,
  ...initialPreferenceState,
  ...initialAuthState,
  ...initialCommonState,
  ...initialAgentOnboardingState,
  ...initialOnboardingState,
};

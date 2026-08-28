import { type UserOnboarding } from '@/types/user';

export interface OnboardingState {
  /**
   * Local step for optimistic UI updates.
   * When set, takes precedence over server state for immediate UI feedback.
   */
  localOnboardingStep?: number;
  onboarding?: UserOnboarding;
}

export const initialOnboardingState: OnboardingState = {
  localOnboardingStep: undefined,
  onboarding: undefined,
};

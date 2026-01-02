import { type UserOnboarding } from '@/types/user';

export interface OnboardingState {
  /**
   * Whether the step update queue is currently being processed.
   */
  isProcessingStepQueue: boolean;
  /**
   * Local step for optimistic UI updates.
   * When set, takes precedence over server state for immediate UI feedback.
   */
  localOnboardingStep?: number;
  onboarding?: UserOnboarding;
  /**
   * Queue for managing server updates with max length 2.
   * - Position 0: Currently executing task
   * - Position 1: Pending task (replaced if new task arrives while queue is full)
   */
  stepUpdateQueue: number[];
}

export const initialOnboardingState: OnboardingState = {
  isProcessingStepQueue: false,
  localOnboardingStep: undefined,
  onboarding: undefined,
  stepUpdateQueue: [],
};

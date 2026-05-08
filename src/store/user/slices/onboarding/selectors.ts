import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import { MAX_ONBOARDING_STEPS } from '@lobechat/types';

import { type UserStore } from '../../store';
import { agentOnboardingSelectors } from '../agentOnboarding/selectors';

/**
 * Returns the current step for UI display.
 * Prioritizes local optimistic state over server state for immediate feedback.
 * Clamps the value to valid range [1, MAX_ONBOARDING_STEPS].
 */
const currentStep = (s: UserStore) => {
  const step = s.localOnboardingStep ?? s.onboarding?.currentStep ?? 1;
  return Math.max(1, Math.min(step, MAX_ONBOARDING_STEPS));
};

const version = (s: UserStore) => s.onboarding?.version ?? CURRENT_ONBOARDING_VERSION;

const finishedAt = (s: UserStore) => s.onboarding?.finishedAt;

const isFinished = (s: UserStore) => !!s.onboarding?.finishedAt;

/**
 * Check if user needs to go through onboarding.
 */
const needsOnboarding = (s: Pick<UserStore, 'agentOnboarding' | 'onboarding'>) => {
  if (agentOnboardingSelectors.isFinished(s)) return false;

  return (
    !s.onboarding?.finishedAt ||
    (s.onboarding?.version && s.onboarding.version < CURRENT_ONBOARDING_VERSION)
  );
};

/**
 * Whether the shared-prefix steps have been completed.
 *
 * Only `responseLanguage` is checked: completing the shared prefix is
 * marked by writing it on step 2. Telemetry can't be used as a signal
 * because `setSettings` strips fields that match the default
 * (DEFAULT_COMMON_SETTINGS.telemetry === true), so a user who keeps
 * the default-on choice never persists telemetry to s.settings.
 */
const commonStepsCompleted = (s: Pick<UserStore, 'settings'>) =>
  s.settings?.general?.responseLanguage !== undefined;

export const onboardingSelectors = {
  commonStepsCompleted,
  currentStep,
  finishedAt,
  isFinished,
  needsOnboarding,
  version,
};

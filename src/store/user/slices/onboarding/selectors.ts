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
 * Whether the shared-prefix steps (Welcome+Language, Privacy) have been completed.
 * Reads RAW stored settings (s.settings), not the default-merged currentSettings,
 * so unset users are correctly distinguished from users who explicitly chose.
 */
const commonStepsCompleted = (s: Pick<UserStore, 'settings'>) => {
  const general = s.settings?.general;
  return general?.responseLanguage !== undefined && general?.telemetry !== undefined;
};

export const onboardingSelectors = {
  commonStepsCompleted,
  currentStep,
  finishedAt,
  isFinished,
  needsOnboarding,
  version,
};

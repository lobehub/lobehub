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
 * Whether the shared-prefix steps (Welcome+Privacy, Language) have been completed.
 *
 * Derives from the RAW stored `responseLanguage` only — the flow guarantees step 1
 * (telemetry) precedes step 2 (language), so a stored responseLanguage implies
 * both steps were completed.
 *
 * `telemetry` cannot be used as a signal: DEFAULT_COMMON_SETTINGS sets it to `true`,
 * and setSettings strips fields equal to defaults from `s.settings`, so accepting
 * the default leaves `telemetry` undefined in raw stored settings. `responseLanguage`
 * has no default, so any explicit choice is preserved.
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

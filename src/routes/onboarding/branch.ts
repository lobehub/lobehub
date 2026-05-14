import { AGENT_ONBOARDING_ENABLED } from '@lobechat/business-const';

export const ONBOARDING_AGENT_PATH = '/onboarding/agent';
export const ONBOARDING_CLASSIC_PATH = '/onboarding/classic';

export type OnboardingBranchPath = typeof ONBOARDING_AGENT_PATH | typeof ONBOARDING_CLASSIC_PATH;

interface DeriveOnboardingBranchInput {
  enableAgentOnboarding: boolean;
  isDesktop: boolean;
}

/**
 * Decide which branch the user enters after the shared-prefix steps complete.
 * `AGENT_ONBOARDING_ENABLED` is the build-time master switch, so the agent
 * flow stays unreachable when it is disabled regardless of runtime flags.
 */
export const deriveOnboardingBranchPath = ({
  enableAgentOnboarding,
  isDesktop,
}: DeriveOnboardingBranchInput): OnboardingBranchPath => {
  if (!AGENT_ONBOARDING_ENABLED || isDesktop || !enableAgentOnboarding) {
    return ONBOARDING_CLASSIC_PATH;
  }
  return ONBOARDING_AGENT_PATH;
};

import type { UserAgentOnboarding } from '@/types/user';

export interface AgentOnboardingState {
  agentOnboarding?: UserAgentOnboarding;
}

export const initialAgentOnboardingState: AgentOnboardingState = {
  agentOnboarding: undefined,
};

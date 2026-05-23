import type { UserAgentOnboarding, UserAgentOnboardingContext } from '@/types/user';

export interface AgentOnboardingBootstrapContext {
  agentOnboarding: UserAgentOnboarding;
  context: UserAgentOnboardingContext;
  topicId: string | null;
}

interface ResolveAgentOnboardingContextParams {
  bootstrapContext?: AgentOnboardingBootstrapContext;
  storedAgentOnboarding?: UserAgentOnboarding;
}

export const resolveAgentOnboardingContext = ({
  bootstrapContext,
  storedAgentOnboarding,
}: ResolveAgentOnboardingContextParams) => {
  return {
    topicId: bootstrapContext?.topicId ?? storedAgentOnboarding?.activeTopicId,
  };
};

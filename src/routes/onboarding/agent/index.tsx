import { AGENT_ONBOARDING_ENABLED } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { memo } from 'react';
import { Navigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentOnboardingPage from '@/features/Onboarding/Agent';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

const AgentOnboardingRoute = memo(() => {
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const commonStepsCompleted = useUserStore(onboardingSelectors.commonStepsCompleted);

  // Master switch precedes every other gate: when the agent flow is disabled
  // at build time, this route is unreachable regardless of runtime config.
  if (!AGENT_ONBOARDING_ENABLED || isDesktop) {
    return <Navigate replace to="/onboarding/classic" />;
  }

  if (!serverConfigInit || !isUserStateInit) return <Loading debugId="AgentOnboardingRoute" />;

  if (!enableAgentOnboarding) {
    return <Navigate replace to="/onboarding/classic" />;
  }

  if (!commonStepsCompleted) {
    return <Navigate replace to="/onboarding" />;
  }

  return <AgentOnboardingPage />;
});

AgentOnboardingRoute.displayName = 'AgentOnboardingRoute';

export default AgentOnboardingRoute;

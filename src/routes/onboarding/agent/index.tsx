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

  if (isDesktop) {
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

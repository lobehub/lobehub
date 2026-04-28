import { isDesktop } from '@lobechat/const';
import { memo } from 'react';
import { Navigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentOnboardingPage from '@/features/Onboarding/Agent';
import { useServerConfigStore } from '@/store/serverConfig';

const AgentOnboardingRoute = memo(() => {
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  if (isDesktop) {
    return <Navigate replace to="/onboarding/classic" />;
  }

  if (!serverConfigInit) return <Loading debugId="AgentOnboardingRoute" />;

  if (!enableAgentOnboarding) {
    return <Navigate replace to="/onboarding/classic" />;
  }

  return <AgentOnboardingPage />;
});

AgentOnboardingRoute.displayName = 'AgentOnboardingRoute';

export default AgentOnboardingRoute;

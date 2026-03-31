import { memo } from 'react';
import { Navigate } from 'react-router-dom';

import AgentOnboardingPage from '@/features/Onboarding/Agent';
import { AGENT_ONBOARDING_ENABLED } from '@/routes/onboarding/config';

const AgentOnboardingRoute = memo(() => {
  if (!AGENT_ONBOARDING_ENABLED) {
    return <Navigate replace to="/onboarding/classic" />;
  }

  return <AgentOnboardingPage />;
});

AgentOnboardingRoute.displayName = 'AgentOnboardingRoute';

export default AgentOnboardingRoute;

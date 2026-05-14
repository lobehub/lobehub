import { AGENT_ONBOARDING_ENABLED } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { memo, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentOnboardingPage from '@/features/Onboarding/Agent';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

const AgentOnboardingRoute = memo(() => {
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const refreshServerConfig = useServerConfigStore((s) => s.refreshServerConfig);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const commonStepsCompleted = useUserStore(onboardingSelectors.commonStepsCompleted);
  const [runtimeConfigReady, setRuntimeConfigReady] = useState(false);
  const runtimeConfigRefreshRef = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => {
    if (!AGENT_ONBOARDING_ENABLED || isDesktop) return;

    if (!serverConfigInit || !isUserStateInit || runtimeConfigReady) return;

    let cancelled = false;
    const refreshPromise =
      runtimeConfigRefreshRef.current ??
      refreshServerConfig().catch((error) => {
        console.error('[Onboarding] Failed to refresh server config before agent guard', error);
      });

    runtimeConfigRefreshRef.current = refreshPromise;
    void refreshPromise.finally(() => {
      if (runtimeConfigRefreshRef.current === refreshPromise) {
        runtimeConfigRefreshRef.current = undefined;
      }
      if (!cancelled) setRuntimeConfigReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isUserStateInit, refreshServerConfig, runtimeConfigReady, serverConfigInit]);

  // Master switch precedes every other gate: when the agent flow is disabled
  // at build time, this route is unreachable regardless of runtime config.
  if (!AGENT_ONBOARDING_ENABLED || isDesktop) {
    return <Navigate replace to="/onboarding/classic" />;
  }

  if (!serverConfigInit || !isUserStateInit || !runtimeConfigReady) {
    return <Loading debugId="AgentOnboardingRoute" />;
  }

  if (!commonStepsCompleted) {
    return <Navigate replace to="/onboarding" />;
  }

  if (!enableAgentOnboarding) {
    return <Navigate replace to="/onboarding/classic" />;
  }

  return <AgentOnboardingPage />;
});

AgentOnboardingRoute.displayName = 'AgentOnboardingRoute';

export default AgentOnboardingRoute;

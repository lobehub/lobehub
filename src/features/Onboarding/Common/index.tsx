'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import OnboardingContainer from '@/routes/onboarding/_layout';
import { deriveOnboardingBranchPath } from '@/routes/onboarding/config';
import ResponseLanguageStep from '@/routes/onboarding/features/ResponseLanguageStep';
import TelemetryStep from '@/routes/onboarding/features/TelemetryStep';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

const CommonOnboardingPage = memo(() => {
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const commonStepsCompleted = useUserStore(onboardingSelectors.commonStepsCompleted);
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  const [searchParams, setSearchParams] = useSearchParams();
  const step: 1 | 2 = searchParams.get('step') === '2' ? 2 : 1;

  const goNextFromTelemetry = useCallback(() => {
    setSearchParams({ step: '2' }, { replace: true });
  }, [setSearchParams]);

  const goBackFromLanguage = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const finishCommon = useCallback(() => {
    // No-op: completion of step 2 writes responseLanguage, which flips
    // commonStepsCompleted to true; the early-return below then handles
    // the redirect on the next render.
  }, []);

  if (!isUserStateInit) {
    return <Loading debugId="CommonOnboarding/userState" />;
  }

  if (commonStepsCompleted) {
    if (!serverConfigInit) {
      return <Loading debugId="CommonOnboarding/serverConfig" />;
    }
    const branchPath = deriveOnboardingBranchPath({
      enableAgentOnboarding: !!enableAgentOnboarding,
      isDesktop,
    });
    return <Navigate replace to={branchPath} />;
  }

  return (
    <OnboardingContainer>
      <Flexbox gap={24} style={{ maxWidth: 600, width: '100%' }}>
        {step === 1 ? (
          <TelemetryStep onNext={goNextFromTelemetry} />
        ) : (
          <ResponseLanguageStep onBack={goBackFromLanguage} onNext={finishCommon} />
        )}
      </Flexbox>
    </OnboardingContainer>
  );
});

CommonOnboardingPage.displayName = 'CommonOnboardingPage';

export default CommonOnboardingPage;

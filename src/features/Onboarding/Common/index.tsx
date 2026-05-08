'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import OnboardingContainer from '@/routes/onboarding/_layout';
import { deriveOnboardingBranchPath } from '@/routes/onboarding/config';
import IntroLanguageStep from '@/routes/onboarding/features/IntroLanguageStep';
import PrivacyStep from '@/routes/onboarding/features/PrivacyStep';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

const CommonOnboardingPage = memo(() => {
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const commonStepsCompleted = useUserStore(onboardingSelectors.commonStepsCompleted);
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  const [step, setStep] = useState<1 | 2>(1);

  const goNextFromIntro = useCallback(() => {
    setStep(2);
  }, []);

  const goBackFromPrivacy = useCallback(() => {
    setStep(1);
  }, []);

  const finishCommon = useCallback(() => {
    // No-op: completion of step 2 writes telemetry, which flips
    // commonStepsCompleted to true; the early-return below then
    // handles the redirect on the next render.
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
          <IntroLanguageStep onNext={goNextFromIntro} />
        ) : (
          <PrivacyStep onBack={goBackFromPrivacy} onNext={finishCommon} />
        )}
      </Flexbox>
    </OnboardingContainer>
  );
});

CommonOnboardingPage.displayName = 'CommonOnboardingPage';

export default CommonOnboardingPage;

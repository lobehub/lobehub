'use client';

import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import ModeSwitch from '@/features/Onboarding/components/ModeSwitch';
import OnboardingContainer from '@/routes/onboarding/_layout';
import FullNameStep from '@/routes/onboarding/features/FullNameStep';
import InterestsStep from '@/routes/onboarding/features/InterestsStep';
import ProSettingsStep from '@/routes/onboarding/features/ProSettingsStep';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

const ClassicOnboardingPage = memo(() => {
  const navigate = useNavigate();
  const [isUserStateInit, commonStepsCompleted, currentStep, goToNextStep, goToPreviousStep] =
    useUserStore((s) => [
      s.isUserStateInit,
      onboardingSelectors.commonStepsCompleted(s),
      onboardingSelectors.currentStep(s),
      s.goToNextStep,
      s.goToPreviousStep,
    ]);

  // FullNameStep is the branch's first step, so its back button leaves the
  // branch and re-enters the shared prefix's ResponseLanguageStep (step 2).
  const backToResponseLanguageStep = useCallback(() => {
    navigate('/onboarding?step=2', { replace: true });
  }, [navigate]);

  if (!isUserStateInit) {
    return <Loading debugId="ClassicOnboarding" />;
  }

  if (!commonStepsCompleted) {
    return <Navigate replace to="/onboarding" />;
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1: {
        return <FullNameStep onBack={backToResponseLanguageStep} onNext={goToNextStep} />;
      }
      case 2: {
        return <InterestsStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case MAX_ONBOARDING_STEPS: {
        return <ProSettingsStep onBack={goToPreviousStep} />;
      }
      default: {
        return null;
      }
    }
  };

  return (
    <OnboardingContainer>
      <Flexbox gap={24} style={{ maxWidth: 600, width: '100%' }}>
        <ModeSwitch />
        {renderStep()}
      </Flexbox>
    </OnboardingContainer>
  );
});

ClassicOnboardingPage.displayName = 'ClassicOnboardingPage';

export default ClassicOnboardingPage;

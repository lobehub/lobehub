'use client';

import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

import OnboardingContainer from './_layout';
import FullNameStep from './features/FullNameStep';
import InterestsStep from './features/InterestsStep';
import ProSettingsStep from './features/ProSettingsStep';
import ResponseLanguageStep from './features/ResponseLanguageStep';
import TelemetryStep from './features/TelemetryStep';

const OnboardingPage = memo(() => {
  const [isUserStateInit, currentStep, goToNextStep, goToPreviousStep] = useUserStore((s) => [
    s.isUserStateInit,
    onboardingSelectors.currentStep(s),
    s.goToNextStep,
    s.goToPreviousStep,
  ]);

  if (!isUserStateInit) {
    return <Loading debugId="Onboarding" />;
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1: {
        return <TelemetryStep onNext={goToNextStep} />;
      }
      case 2: {
        return <FullNameStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case 3: {
        return <InterestsStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case 4: {
        return <ResponseLanguageStep onBack={goToPreviousStep} onNext={goToNextStep} />;
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
      <Flexbox gap={24} style={{ maxWidth: 480, width: '100%' }}>
        {renderStep()}
      </Flexbox>
    </OnboardingContainer>
  );
});

OnboardingPage.displayName = 'OnboardingPage';

export default OnboardingPage;

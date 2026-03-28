'use client';

import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import ModeSwitch from '@/features/Onboarding/components/ModeSwitch';
import OnboardingContainer from '@/routes/onboarding/_layout';
import FullNameStep from '@/routes/onboarding/features/FullNameStep';
import InterestsStep from '@/routes/onboarding/features/InterestsStep';
import ProSettingsStep from '@/routes/onboarding/features/ProSettingsStep';
import ResponseLanguageStep from '@/routes/onboarding/features/ResponseLanguageStep';
import TelemetryStep from '@/routes/onboarding/features/TelemetryStep';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';
import { isDev } from '@/utils/env';

const ClassicOnboardingPage = memo(() => {
  const { t } = useTranslation('onboarding');
  const [isUserStateInit, currentStep, goToNextStep, goToPreviousStep, resetOnboarding] =
    useUserStore((s) => [
      s.isUserStateInit,
      onboardingSelectors.currentStep(s),
      s.goToNextStep,
      s.goToPreviousStep,
      s.resetOnboarding,
    ]);
  const [isResetting, setIsResetting] = useState(false);

  if (!isUserStateInit) {
    return <Loading debugId="ClassicOnboarding" />;
  }

  const handleReset = async () => {
    setIsResetting(true);

    try {
      await resetOnboarding();
    } finally {
      setIsResetting(false);
    }
  };

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
        <ModeSwitch
          actions={
            isDev ? (
              <Button danger loading={isResetting} size={'small'} onClick={handleReset}>
                {t('agent.modeSwitch.reset')}
              </Button>
            ) : undefined
          }
        />
        {renderStep()}
      </Flexbox>
    </OnboardingContainer>
  );
});

ClassicOnboardingPage.displayName = 'ClassicOnboardingPage';

export default ClassicOnboardingPage;

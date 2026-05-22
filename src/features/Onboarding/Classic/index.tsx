'use client';

import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import ModeSwitch from '@/features/Onboarding/components/ModeSwitch';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOnboardingAgentTemplates } from '@/hooks/useOnboardingAgentTemplates';
import OnboardingContainer from '@/routes/onboarding/_layout';
import AgentPickerStep from '@/routes/onboarding/features/AgentPickerStep';
import FullNameStep from '@/routes/onboarding/features/FullNameStep';
import InterestsStep from '@/routes/onboarding/features/InterestsStep';
import ProSettingsStep from '@/routes/onboarding/features/ProSettingsStep';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';
import { isDev } from '@/utils/env';

const INTERESTS_STEP = 2;
const PRO_SETTINGS_STEP = 3;

const ClassicOnboardingPage = memo(() => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [
    isUserStateInit,
    commonStepsCompleted,
    currentStep,
    goToNextStep,
    goToPreviousStep,
  ] = useUserStore((s) => [
    s.isUserStateInit,
    onboardingSelectors.commonStepsCompleted(s),
    onboardingSelectors.currentStep(s),
    s.goToNextStep,
    s.goToPreviousStep,
  ]);
  const enableKlavis = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const shouldSkipProSettingsStep = serverConfigInit && !enableKlavis;

  useOnboardingAgentTemplates(isUserStateInit && commonStepsCompleted);

  // FullNameStep is the branch's first step, so its back button leaves the
  // branch and re-enters the shared prefix's ResponseLanguageStep (step 2).
  const backToResponseLanguageStep = useCallback(() => {
    navigate('/onboarding?step=2', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (
      !isUserStateInit ||
      !commonStepsCompleted ||
      currentStep !== PRO_SETTINGS_STEP ||
      !shouldSkipProSettingsStep
    ) {
      return;
    }

    goToNextStep();
  }, [commonStepsCompleted, currentStep, goToNextStep, isUserStateInit, shouldSkipProSettingsStep]);

  const goToNextStepFromInterests = useCallback(() => {
    if (shouldSkipProSettingsStep) {
      goToNextStep();
      goToNextStep();
      return;
    }

    goToNextStep();
  }, [goToNextStep, shouldSkipProSettingsStep]);

  const goToPreviousStepFromAgentPicker = useCallback(() => {
    if (shouldSkipProSettingsStep) {
      goToPreviousStep();
      goToPreviousStep();
      return;
    }

    goToPreviousStep();
  }, [goToPreviousStep, shouldSkipProSettingsStep]);

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
      case INTERESTS_STEP: {
        return <InterestsStep onBack={goToPreviousStep} onNext={goToNextStepFromInterests} />;
      }
      case PRO_SETTINGS_STEP: {
        if (!serverConfigInit) return <Loading debugId="ClassicOnboarding/serverConfig" />;
        if (shouldSkipProSettingsStep) return null;

        return <ProSettingsStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case MAX_ONBOARDING_STEPS: {
        return <AgentPickerStep onBack={goToPreviousStepFromAgentPicker} />;
      }
      default: {
        return null;
      }
    }
  };

  const contentMaxWidth = currentStep === MAX_ONBOARDING_STEPS ? 780 : 600;

  return (
    <OnboardingContainer>
      <Flexbox
        gap={24}
        paddingInline={isMobile ? 16 : 0}
        style={{ maxWidth: contentMaxWidth, width: '100%' }}
      >
        {isDev && <ModeSwitch />}
        {renderStep()}
      </Flexbox>
    </OnboardingContainer>
  );
});

ClassicOnboardingPage.displayName = 'ClassicOnboardingPage';

export default ClassicOnboardingPage;

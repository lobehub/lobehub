'use client';

import { CLASSIC_ONBOARDING_MAX_STEP } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import OnboardingContainer from '@/features/Onboarding/Layout';
import AgentPickerStep from '@/features/Onboarding/steps/AgentPickerStep';
import FullNameStep from '@/features/Onboarding/steps/FullNameStep';
import InterestsStep from '@/features/Onboarding/steps/InterestsStep';
import ProSettingsStep from '@/features/Onboarding/steps/ProSettingsStep';
import TaskKickoffStep from '@/features/Onboarding/steps/TaskKickoffStep';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOnboardingAgentTemplates } from '@/hooks/useOnboardingAgentTemplates';
import { useSingleton } from '@/hooks/useSingleton';
import {
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
} from '@/services/onboardingMetrics';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

import { isLegacyClassicStep, remapLegacyClassicStep } from './legacyStep';

const INTERESTS_STEP = 2;
const PRO_SETTINGS_STEP = 3;

const CLASSIC_STEP_TRACKING = {
  1: { flow: 'classic', step: 'fullname', stepIndex: 1 },
  [INTERESTS_STEP]: { flow: 'classic', step: 'interests', stepIndex: 2 },
  [PRO_SETTINGS_STEP]: { flow: 'classic', step: 'prosettings', stepIndex: 3 },
  [CLASSIC_ONBOARDING_MAX_STEP]: { flow: 'classic', step: 'agentpicker', stepIndex: 4 },
} as const;

// The closing hand-off renders after onboarding is finished, so it lives in
// the URL instead of the persisted step (steps past the max are legacy ones).
const KICKOFF_PARAM = 'kickoff';
const POST_ONBOARDING_HOME = '/';

const getClassicStepTrackingPayload = (step: number) =>
  CLASSIC_STEP_TRACKING[step as keyof typeof CLASSIC_STEP_TRACKING];

const ClassicOnboardingPage = memo(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [
    isUserStateInit,
    commonStepsCompleted,
    isFinished,
    currentStep,
    goToNextStep,
    goToPreviousStep,
    setOnboardingStep,
  ] = useUserStore((s) => [
    s.isUserStateInit,
    onboardingSelectors.commonStepsCompleted(s),
    onboardingSelectors.isFinished(s),
    onboardingSelectors.currentStep(s),
    s.goToNextStep,
    s.goToPreviousStep,
    s.setOnboardingStep,
  ]);
  const enableComposio = useServerConfigStore(serverConfigSelectors.enableComposio);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const shouldSkipProSettingsStep = serverConfigInit && !enableComposio;
  const autoSkippedStepKeys = useSingleton(() => new Set<string>());
  const viewedStepKeys = useSingleton(() => new Set<string>());
  const legacyRemappedRef = useRef(false);
  const showKickoff = isFinished && searchParams.get(KICKOFF_PARAM) === '1';
  const isAgentSkipEntry = searchParams.get('entry') === 'skip';

  useOnboardingAgentTemplates(isUserStateInit && commonStepsCompleted);

  useEffect(() => {
    if (!isUserStateInit || legacyRemappedRef.current) return;
    legacyRemappedRef.current = true;
    if (isLegacyClassicStep(currentStep)) {
      void setOnboardingStep(remapLegacyClassicStep(currentStep));
    }
  }, [currentStep, isUserStateInit, setOnboardingStep]);

  const renderableStep = isLegacyClassicStep(currentStep)
    ? remapLegacyClassicStep(currentStep)
    : currentStep;

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

    const payload = CLASSIC_STEP_TRACKING[PRO_SETTINGS_STEP];
    if (autoSkippedStepKeys.has(payload.step)) return;

    autoSkippedStepKeys.add(payload.step);
    trackOnboardingStepCompleted({
      ...payload,
      action: 'auto_skip',
      skipped: true,
    });
    goToNextStep();
  }, [
    autoSkippedStepKeys,
    commonStepsCompleted,
    currentStep,
    goToNextStep,
    isUserStateInit,
    shouldSkipProSettingsStep,
  ]);

  useEffect(() => {
    if (!isUserStateInit || !commonStepsCompleted || showKickoff) return;
    if (currentStep === PRO_SETTINGS_STEP && (!serverConfigInit || shouldSkipProSettingsStep)) {
      return;
    }

    const payload = getClassicStepTrackingPayload(currentStep);
    if (!payload || viewedStepKeys.has(payload.step)) return;

    viewedStepKeys.add(payload.step);
    trackOnboardingStepViewed(payload);
  }, [
    commonStepsCompleted,
    currentStep,
    isUserStateInit,
    serverConfigInit,
    shouldSkipProSettingsStep,
    showKickoff,
    viewedStepKeys,
  ]);

  const goToNextStepFromFullName = useCallback(() => {
    trackOnboardingStepCompleted(CLASSIC_STEP_TRACKING[1]);
    goToNextStep();
  }, [goToNextStep]);

  const goToNextStepFromInterests = useCallback(() => {
    trackOnboardingStepCompleted(
      shouldSkipProSettingsStep
        ? {
            ...CLASSIC_STEP_TRACKING[INTERESTS_STEP],
            skippedNextStep: 'prosettings',
          }
        : CLASSIC_STEP_TRACKING[INTERESTS_STEP],
    );

    if (shouldSkipProSettingsStep) {
      goToNextStep();
      goToNextStep();
      return;
    }

    goToNextStep();
  }, [goToNextStep, shouldSkipProSettingsStep]);

  const goToNextStepFromProSettings = useCallback(() => {
    trackOnboardingStepCompleted(CLASSIC_STEP_TRACKING[PRO_SETTINGS_STEP]);
    goToNextStep();
  }, [goToNextStep]);

  const goToPreviousStepFromAgentPicker = useCallback(() => {
    if (shouldSkipProSettingsStep) {
      goToPreviousStep();
      goToPreviousStep();
      return;
    }

    goToPreviousStep();
  }, [goToPreviousStep, shouldSkipProSettingsStep]);

  // A signup that carried its own target, or the agent flow's skip entry,
  // goes straight there; a plain classic finish hands off to the kickoff step.
  const handleAgentPickerFinished = useCallback(
    (targetUrl: string) => {
      if (isAgentSkipEntry || targetUrl !== POST_ONBOARDING_HOME) {
        navigate(targetUrl);
        return;
      }
      setSearchParams({ [KICKOFF_PARAM]: '1' }, { replace: true });
    },
    [isAgentSkipEntry, navigate, setSearchParams],
  );

  if (!isUserStateInit) {
    return <Loading debugId="ClassicOnboarding" />;
  }

  if (!commonStepsCompleted) {
    return <Navigate replace to="/onboarding" />;
  }

  const renderStep = () => {
    if (showKickoff) return <TaskKickoffStep />;

    switch (renderableStep) {
      case 1: {
        return (
          <FullNameStep onBack={backToResponseLanguageStep} onNext={goToNextStepFromFullName} />
        );
      }
      case INTERESTS_STEP: {
        return <InterestsStep onBack={goToPreviousStep} onNext={goToNextStepFromInterests} />;
      }
      case PRO_SETTINGS_STEP: {
        if (!serverConfigInit) return <Loading debugId="ClassicOnboarding/serverConfig" />;
        if (shouldSkipProSettingsStep) return null;

        return <ProSettingsStep onBack={goToPreviousStep} onNext={goToNextStepFromProSettings} />;
      }
      case CLASSIC_ONBOARDING_MAX_STEP: {
        return (
          <AgentPickerStep
            onBack={goToPreviousStepFromAgentPicker}
            onFinished={handleAgentPickerFinished}
          />
        );
      }
      default: {
        return null;
      }
    }
  };

  const contentMaxWidth =
    !showKickoff && renderableStep === CLASSIC_ONBOARDING_MAX_STEP ? 780 : 600;

  return (
    <OnboardingContainer>
      <Flexbox
        gap={24}
        paddingInline={isMobile ? 16 : 0}
        style={{ maxWidth: contentMaxWidth, width: '100%' }}
      >
        {renderStep()}
      </Flexbox>
    </OnboardingContainer>
  );
});

ClassicOnboardingPage.displayName = 'ClassicOnboardingPage';

export default ClassicOnboardingPage;

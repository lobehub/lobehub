import { OnboardingStep } from '@lobechat/types';
import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';

import {
  type OnboardingStep as OnboardingMetricsStep,
  trackOnboardingCompleted,
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
} from '@/services/onboardingMetrics';
import { useUserStore } from '@/store/user';
import { consumeOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import {
  getNextOnboardingStep,
  getPreviousOnboardingStep,
  getVisibleOnboardingSteps,
  isLastVisibleStep,
  resolveVisibleStep,
} from './steps';
import { useOnboardingCapabilities } from './useOnboardingCapabilities';

const ONBOARDING_METRICS_FLOW = 'web';

const ONBOARDING_STEP_METRIC_ID: Record<OnboardingStep, OnboardingMetricsStep> = {
  [OnboardingStep.Welcome]: 'welcome',
  [OnboardingStep.ConnectApps]: 'connect_apps',
  [OnboardingStep.LearnYourWorld]: 'learn_your_world',
  [OnboardingStep.Profile]: 'profile',
  [OnboardingStep.ChiefAgent]: 'chief_agent',
  [OnboardingStep.Messenger]: 'messenger',
  [OnboardingStep.StarterTasks]: 'starter_tasks',
};

export interface OnboardingFlowController {
  back: () => Promise<void>;
  currentStep: OnboardingStep;
  finish: () => Promise<void>;
  hasPrevious: boolean;
  isLast: boolean;
  next: () => Promise<void>;
  visibleSteps: OnboardingStep[];
}

export const useOnboardingFlow = (): OnboardingFlowController => {
  const navigate = useNavigate();
  const capabilities = useOnboardingCapabilities();
  const visibleSteps = useMemo(() => getVisibleOnboardingSteps(capabilities), [capabilities]);

  const persistedStep = useUserStore((s) => s.localOnboardingStep ?? s.onboarding?.currentStep);
  const setOnboardingStep = useUserStore((s) => s.setOnboardingStep);
  const finishOnboarding = useUserStore((s) => s.finishOnboarding);

  const currentStep = resolveVisibleStep(persistedStep, visibleSteps);
  const isLast = isLastVisibleStep(currentStep, visibleSteps);
  const hasPrevious = getPreviousOnboardingStep(currentStep, visibleSteps) !== undefined;

  useEffect(() => {
    trackOnboardingStepViewed({
      flow: ONBOARDING_METRICS_FLOW,
      step: ONBOARDING_STEP_METRIC_ID[currentStep],
      stepIndex: currentStep,
    });
  }, [currentStep]);

  const finish = useCallback(async () => {
    await finishOnboarding();
    const targetUrl = consumeOnboardingCallbackUrl() || '/';
    trackOnboardingCompleted({ flow: ONBOARDING_METRICS_FLOW, targetUrl });
    navigate(targetUrl);
  }, [finishOnboarding, navigate]);

  const next = useCallback(async () => {
    if (isLastVisibleStep(currentStep, visibleSteps)) {
      await finish();
      trackOnboardingStepCompleted({
        flow: ONBOARDING_METRICS_FLOW,
        step: ONBOARDING_STEP_METRIC_ID[currentStep],
        stepIndex: currentStep,
      });
      return;
    }

    const target = getNextOnboardingStep(currentStep, visibleSteps);
    if (target !== undefined) await setOnboardingStep(target);
    trackOnboardingStepCompleted({
      flow: ONBOARDING_METRICS_FLOW,
      step: ONBOARDING_STEP_METRIC_ID[currentStep],
      stepIndex: currentStep,
    });
  }, [currentStep, visibleSteps, finish, setOnboardingStep]);

  const back = useCallback(async () => {
    const target = getPreviousOnboardingStep(currentStep, visibleSteps);
    if (target !== undefined) await setOnboardingStep(target);
  }, [currentStep, visibleSteps, setOnboardingStep]);

  return { back, currentStep, finish, hasPrevious, isLast, next, visibleSteps };
};

import type { OnboardingStep } from '@lobechat/types';
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';

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

  const finish = useCallback(async () => {
    await finishOnboarding();
    const targetUrl = consumeOnboardingCallbackUrl() || '/';
    navigate(targetUrl);
  }, [finishOnboarding, navigate]);

  const next = useCallback(async () => {
    if (isLastVisibleStep(currentStep, visibleSteps)) {
      await finish();
      return;
    }

    const target = getNextOnboardingStep(currentStep, visibleSteps);
    if (target !== undefined) await setOnboardingStep(target);
  }, [currentStep, visibleSteps, finish, setOnboardingStep]);

  const back = useCallback(async () => {
    const target = getPreviousOnboardingStep(currentStep, visibleSteps);
    if (target !== undefined) await setOnboardingStep(target);
  }, [currentStep, visibleSteps, setOnboardingStep]);

  return { back, currentStep, finish, hasPrevious, isLast, next, visibleSteps };
};

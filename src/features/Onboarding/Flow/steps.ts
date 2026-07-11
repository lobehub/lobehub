import type { OnboardingCapabilities } from '@lobechat/types';
import { OnboardingStep } from '@lobechat/types';

export const getVisibleOnboardingSteps = (
  capabilities: OnboardingCapabilities,
): OnboardingStep[] => {
  const steps: OnboardingStep[] = [OnboardingStep.Welcome];

  if (capabilities.composio) {
    steps.push(OnboardingStep.ConnectApps);

    if (capabilities.analysis) {
      steps.push(OnboardingStep.LearnYourWorld, OnboardingStep.Profile);
    }
  }

  steps.push(OnboardingStep.ChiefAgent);

  if (capabilities.messenger) {
    steps.push(OnboardingStep.Messenger);
  }

  if (capabilities.starterTasks) {
    steps.push(OnboardingStep.StarterTasks);
  }

  return steps;
};

export const getNextOnboardingStep = (
  current: OnboardingStep,
  visible: OnboardingStep[],
): OnboardingStep | undefined => visible.find((step) => step > current);

export const getPreviousOnboardingStep = (
  current: OnboardingStep,
  visible: OnboardingStep[],
): OnboardingStep | undefined => [...visible].reverse().find((step) => step < current);

export const isLastVisibleStep = (current: OnboardingStep, visible: OnboardingStep[]): boolean =>
  getNextOnboardingStep(current, visible) === undefined;

export const resolveVisibleStep = (
  persisted: number | undefined,
  visible: OnboardingStep[],
): OnboardingStep => {
  const firstVisible = visible[0];
  const lastVisible = visible.at(-1) ?? firstVisible;

  if (persisted === undefined) return firstVisible;

  const isValidStep = Object.values(OnboardingStep).includes(persisted as OnboardingStep);

  if (!isValidStep) return firstVisible;

  const persistedStep = persisted as OnboardingStep;

  if (visible.includes(persistedStep)) return persistedStep;

  return getNextOnboardingStep(persistedStep, visible) ?? lastVisible;
};

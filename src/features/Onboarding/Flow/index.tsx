'use client';

import { OnboardingStep } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import ChiefAgent from './steps/ChiefAgent';
import ConnectApps from './steps/ConnectApps';
import LearnYourWorld from './steps/LearnYourWorld';
import Messenger from './steps/Messenger';
import Profile from './steps/Profile';
import StarterTasks from './steps/StarterTasks';
import Welcome from './steps/Welcome';
import { useOnboardingFlow } from './useOnboardingFlow';

const STEP_COMPONENTS = {
  [OnboardingStep.Welcome]: Welcome,
  [OnboardingStep.ConnectApps]: ConnectApps,
  [OnboardingStep.LearnYourWorld]: LearnYourWorld,
  [OnboardingStep.Profile]: Profile,
  [OnboardingStep.ChiefAgent]: ChiefAgent,
  [OnboardingStep.Messenger]: Messenger,
  [OnboardingStep.StarterTasks]: StarterTasks,
} as const;

const OnboardingFlowPage = memo(() => {
  const flow = useOnboardingFlow();
  const StepComponent = STEP_COMPONENTS[flow.currentStep];

  return (
    <Flexbox style={{ maxWidth: 600, width: '100%' }}>
      <StepComponent {...flow} />
    </Flexbox>
  );
});

OnboardingFlowPage.displayName = 'OnboardingFlowPage';

export default OnboardingFlowPage;

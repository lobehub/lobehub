'use client';

import { OnboardingStep } from '@lobechat/types';
import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Loader2Icon } from 'lucide-react';
import { memo } from 'react';

import OnBoardingContainer from './Container';
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

  const handleSkip = () => flow.finish({ skipped: true });

  return (
    <OnBoardingContainer onSkip={handleSkip}>
      <Flexbox style={{ maxWidth: 600, width: '100%' }}>
        {flow.isResolving ? (
          <Center height={200} width={'100%'}>
            <Icon spin icon={Loader2Icon} size={24} />
          </Center>
        ) : (
          <StepComponent {...flow} />
        )}
      </Flexbox>
    </OnBoardingContainer>
  );
});

OnboardingFlowPage.displayName = 'OnboardingFlowPage';

export default OnboardingFlowPage;

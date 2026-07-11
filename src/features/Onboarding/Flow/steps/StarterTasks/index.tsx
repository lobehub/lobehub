'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';

const StarterTasks = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');

  return (
    <StepCard
      continueLabel={t('finish')}
      title={t('flow.steps.starterTasks.title')}
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    />
  );
});

StarterTasks.displayName = 'StarterTasks';

export default StarterTasks;

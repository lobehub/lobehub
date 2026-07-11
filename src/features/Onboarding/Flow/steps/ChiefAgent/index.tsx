'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';

const ChiefAgent = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');

  return (
    <StepCard
      title={t('flow.steps.chiefAgent.title')}
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    />
  );
});

ChiefAgent.displayName = 'ChiefAgent';

export default ChiefAgent;

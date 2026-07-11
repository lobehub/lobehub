'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';

const Messenger = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');

  return (
    <StepCard
      title={t('flow.steps.messenger.title')}
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    />
  );
});

Messenger.displayName = 'Messenger';

export default Messenger;

'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';

const ConnectApps = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');

  return (
    <StepCard
      title={t('flow.steps.connectApps.title')}
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    />
  );
});

ConnectApps.displayName = 'ConnectApps';

export default ConnectApps;

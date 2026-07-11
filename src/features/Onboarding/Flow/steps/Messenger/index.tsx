'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import LocalAgentsPanel from './LocalAgentsPanel';
import PlatformRow from './PlatformRow';
import QuoteBanner from './QuoteBanner';
import { useMessengerPlatforms } from './useMessengerPlatforms';

const Messenger = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const { rows } = useMessengerPlatforms();

  return (
    <StepCard
      bannerContent={<QuoteBanner />}
      title={t('flow.steps.messenger.title')}
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    >
      <Flexbox gap={20}>
        <Flexbox gap={4}>
          {rows.map((row) => (
            <PlatformRow key={row.id} {...row} />
          ))}
        </Flexbox>
        <LocalAgentsPanel />
      </Flexbox>
    </StepCard>
  );
});

Messenger.displayName = 'Messenger';

export default Messenger;

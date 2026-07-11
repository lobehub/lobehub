'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import QuoteBanner from '../../QuoteBanner';
import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import LocalAgentsPanel from './LocalAgentsPanel';
import PlatformRow, { PlatformRowSkeleton } from './PlatformRow';
import { PLATFORM_ORDER, useMessengerPlatforms } from './useMessengerPlatforms';

const Messenger = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const { isLoading, rows } = useMessengerPlatforms();

  return (
    <StepCard
      title={t('flow.steps.messenger.title')}
      bannerContent={
        <QuoteBanner
          highlight={t('flow.steps.messenger.quoteHighlight')}
          quote={t('flow.steps.messenger.quote')}
        />
      }
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    >
      <Flexbox gap={20}>
        <Flexbox gap={4}>
          {isLoading
            ? PLATFORM_ORDER.map((id) => <PlatformRowSkeleton key={id} />)
            : rows.map((row) => <PlatformRow key={row.id} {...row} />)}
        </Flexbox>
        <LocalAgentsPanel />
      </Flexbox>
    </StepCard>
  );
});

Messenger.displayName = 'Messenger';

export default Messenger;

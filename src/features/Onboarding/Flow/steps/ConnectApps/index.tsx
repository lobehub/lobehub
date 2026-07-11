'use client';

import { getComposioAppByIdentifier } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import AppRow from './AppRow';

const APP_DESCRIPTION_KEYS = {
  gmail: 'flow.steps.connectApps.apps.gmail.description',
  notion: 'flow.steps.connectApps.apps.notion.description',
  twitter: 'flow.steps.connectApps.apps.twitter.description',
  github: 'flow.steps.connectApps.apps.github.description',
} as const;

const APP_IDENTIFIERS = Object.keys(APP_DESCRIPTION_KEYS) as (keyof typeof APP_DESCRIPTION_KEYS)[];

const ConnectApps = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const useFetchUserComposioConnections = useToolStore((s) => s.useFetchUserComposioConnections);
  useFetchUserComposioConnections(true);

  const apps = useMemo(
    () =>
      APP_IDENTIFIERS.map((identifier) => getComposioAppByIdentifier(identifier)).filter(
        (app) => app !== undefined,
      ),
    [],
  );

  return (
    <StepCard
      description={t('flow.steps.connectApps.description')}
      title={t('flow.steps.connectApps.title')}
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    >
      <Flexbox gap={4}>
        {apps.map((app) => (
          <AppRow
            app={app}
            key={app.identifier}
            description={t(
              APP_DESCRIPTION_KEYS[app.identifier as keyof typeof APP_DESCRIPTION_KEYS],
            )}
          />
        ))}
      </Flexbox>
    </StepCard>
  );
});

ConnectApps.displayName = 'ConnectApps';

export default ConnectApps;

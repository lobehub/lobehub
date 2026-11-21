'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import LobehubSkillItem from '@/features/Settings/skill/features/LobehubSkillItem';
import { SkillListVariantProvider } from '@/features/Settings/skill/features/SkillListRow';
import { densityTokens } from '@/styles/density.stylex';

import type { ConnectorPageId } from './connectorPage';
import ConnectorPageContent from './ConnectorPageContent';
import { resolveConnectorPageView } from './connectorPageView';
import { IntegrationConnectionsSkeleton } from './Skeleton';
import { useConnectorConnection } from './useConnectorConnection';

const styles = stylex.create({
  page: {
    height: '100%',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlockEnd: '24px',
    paddingBlockStart: '8px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
});

const noop = () => {};

interface ConnectorGateProps {
  children: ReactNode;
  identifier: ConnectorPageId;
}

/**
 * A connector page. A connected account gets the regular connector detail
 * (`children`). Without one the page still has a job: the integration is a
 * separate authorization, so it stays here under the connect row.
 */
const ConnectorGate = memo<ConnectorGateProps>(({ children, identifier }) => {
  const { t, ready } = useTranslation('integration');
  const { available, connected, error, isInitialLoading, provider, retry, server } =
    useConnectorConnection(identifier);
  const view = resolveConnectorPageView({
    available,
    error,
    hasProvider: !!provider,
    hasServer: !!server,
    isInitialLoading,
  });

  if (!ready) return <IntegrationConnectionsSkeleton />;
  if (view === 'ready' && connected) return children;

  return (
    <div {...stylex.props(styles.page)}>
      <Flexbox gap={24}>
        {view === 'loading' && <IntegrationConnectionsSkeleton />}
        {view === 'error' && <AsyncError error={error} variant={'block'} onRetry={retry} />}
        {view === 'ready' && provider && (
          <SkillListVariantProvider value={'page'}>
            <LobehubSkillItem
              showConnectLabel
              provider={provider}
              server={server}
              summary={t(`${identifier}.connectorPage.description`)}
              onSelect={noop}
            />
          </SkillListVariantProvider>
        )}
        <ConnectorPageContent identifier={identifier} />
      </Flexbox>
    </div>
  );
});

ConnectorGate.displayName = 'ConnectorGate';

export default ConnectorGate;

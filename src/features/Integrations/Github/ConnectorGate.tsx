'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import LobehubSkillItem from '@/features/Settings/skill/features/LobehubSkillItem';
import { SkillListVariantProvider } from '@/features/Settings/skill/features/SkillListRow';
import { densityTokens } from '@/styles/density.stylex';

import { IntegrationConnectionsSkeleton } from '../Skeleton';
import { useGithubAgentTools } from '../useGithubAgentTools';
import { resolveAgentToolsView } from './agentToolsView';
import RepositoryAccess from './RepositoryAccess';

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

/**
 * GitHub's Marketplace page. A connected account gets the regular connector
 * detail (`children`). Without one the page still has a job: the GitHub App is
 * a separate authorization, so its section stays here under the connect row.
 */
const ConnectorGate = memo<{ children: ReactNode }>(({ children }) => {
  const { t } = useTranslation('integration');
  const { available, connected, error, isInitialLoading, provider, retry, server } =
    useGithubAgentTools();
  const view = resolveAgentToolsView({
    available,
    error,
    hasProvider: !!provider,
    hasServer: !!server,
    isInitialLoading,
  });

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
              summary={t('github.connectorPage.description')}
              onSelect={noop}
            />
          </SkillListVariantProvider>
        )}
        <RepositoryAccess />
      </Flexbox>
    </div>
  );
});

ConnectorGate.displayName = 'GithubConnectorGate';

export default ConnectorGate;

'use client';

import './Github/definition';
import './Linear/definition';

import { memo, useEffect } from 'react';
import { useLocation, useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import GithubIntegration from './Github';
import { buildGithubConnectorPath } from './Github/home';
import IntegrationsLayout from './Layout';
import LinearIntegration from './Linear';
import Overview from './Overview';
import { type IntegrationId, isIntegrationId } from './registry';
import { IntegrationDetailSkeleton } from './Skeleton';
import { useGithubHome } from './useGithubHome';

const BASE_PATH = '/settings/integrations';

/**
 * Settings → Integrations. The bare path is the directory; a known
 * sub-segment opens that integration's page, an unknown one is replaced by
 * the directory so stale deep links degrade gracefully.
 */
const IntegrationsSettings = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ sub?: string }>();
  const { search } = useLocation();
  const githubHome = useGithubHome();
  const selected: IntegrationId | null = isIntegrationId(params.sub) ? params.sub : null;
  const githubMoved = selected === 'github' && githubHome.inMarketplace;

  useEffect(() => {
    if (params.sub && !selected) navigate(BASE_PATH, { replace: true });
  }, [navigate, params.sub, selected]);

  // Old links and the GitHub App install callback still land on this path.
  useEffect(() => {
    if (githubMoved) navigate(buildGithubConnectorPath(search), { replace: true });
  }, [githubMoved, navigate, search]);

  const open = (id: IntegrationId) => navigate(`${BASE_PATH}/${id}`);
  const back = () => navigate(BASE_PATH);

  return (
    <IntegrationsLayout>
      {selected === 'github' ? (
        githubHome.isReady && !githubMoved ? (
          <GithubIntegration onBack={back} />
        ) : (
          <IntegrationDetailSkeleton />
        )
      ) : selected === 'linear' ? (
        <LinearIntegration onBack={back} />
      ) : (
        <Overview onOpen={open} />
      )}
    </IntegrationsLayout>
  );
});

IntegrationsSettings.displayName = 'IntegrationsSettings';

export default IntegrationsSettings;

'use client';

import './Github/definition';

import { memo, useEffect } from 'react';
import { useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import GithubIntegration from './Github';
import IntegrationsLayout from './Layout';
import Overview from './Overview';
import { type IntegrationId, isIntegrationId } from './registry';

const BASE_PATH = '/settings/integrations';

/**
 * Settings → Integrations. The bare path is the directory; a known
 * sub-segment opens that integration's page, an unknown one is replaced by
 * the directory so stale deep links degrade gracefully.
 */
const IntegrationsSettings = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ sub?: string }>();
  const selected: IntegrationId | null = isIntegrationId(params.sub) ? params.sub : null;

  useEffect(() => {
    if (params.sub && !selected) navigate(BASE_PATH, { replace: true });
  }, [navigate, params.sub, selected]);

  const open = (id: IntegrationId) => navigate(`${BASE_PATH}/${id}`);
  const back = () => navigate(BASE_PATH);

  return (
    <IntegrationsLayout>
      {selected === 'github' ? <GithubIntegration onBack={back} /> : <Overview onOpen={open} />}
    </IntegrationsLayout>
  );
});

IntegrationsSettings.displayName = 'IntegrationsSettings';

export default IntegrationsSettings;

'use client';

import './Github/definition';

import { createStaticStyles } from 'antd-style';
import { memo, useEffect } from 'react';
import { useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import GithubIntegration from './Github';
import Overview from './Overview';
import { type IntegrationId, isIntegrationId } from './registry';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    overflow-y: auto;
    flex: 1;
  `,
}));

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
    <div className={styles.page}>
      {selected === 'github' ? <GithubIntegration onBack={back} /> : <Overview onOpen={open} />}
    </div>
  );
});

IntegrationsSettings.displayName = 'IntegrationsSettings';

export default IntegrationsSettings;

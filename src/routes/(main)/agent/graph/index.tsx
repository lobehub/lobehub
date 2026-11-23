'use client';

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AgentSettingsPage from '@/features/AgentSettingsPage';
import GraphSettings from '@/features/AgentSettingsPage/GraphSettings';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const AgentGraphPage = () => {
  const { t } = useTranslation('setting');
  const { aid } = useParams<{ aid: string }>();

  return (
    <ResourceConfigAccessGate
      redirectPath={`/agent/${aid ?? ''}`}
      resourceId={aid}
      resourceType="agent"
    >
      <AgentSettingsPage title={t('agentTab.graph')}>
        <GraphSettings />
      </AgentSettingsPage>
    </ResourceConfigAccessGate>
  );
};

export default AgentGraphPage;

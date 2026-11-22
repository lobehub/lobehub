'use client';

import { useParams } from 'react-router';

import AgentAdvancedSettings from '@/features/AgentAdvancedSettings';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const AgentAdvancedSettingsPage = () => {
  const { aid } = useParams<{ aid: string }>();

  return (
    <ResourceConfigAccessGate
      redirectPath={`/agent/${aid ?? ''}`}
      resourceId={aid}
      resourceType="agent"
    >
      <AgentAdvancedSettings />
    </ResourceConfigAccessGate>
  );
};

export default AgentAdvancedSettingsPage;

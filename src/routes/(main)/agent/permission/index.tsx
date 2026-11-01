'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import AgentPermission from '@/features/AgentPermission';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const AgentPermissionPage = memo(() => {
  const { aid } = useParams<{ aid: string }>();

  // Managing who can do what is a configuration action: a chat-only member gets the same redirect + reason toast as on Agent Profile.
  return (
    <ResourceConfigAccessGate
      redirectPath={`/agent/${aid ?? ''}`}
      resourceId={aid}
      resourceType="agent"
    >
      <AgentPermission />
    </ResourceConfigAccessGate>
  );
});

export default AgentPermissionPage;

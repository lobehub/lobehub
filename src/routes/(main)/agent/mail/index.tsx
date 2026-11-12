'use client';

import { useParams } from 'react-router';

import AgentMail from '@/features/AgentMail';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import { usePermission } from '@/hooks/usePermission';

const AgentMailPage = () => {
  const { aid } = useParams<{ aid?: string }>();
  const { allowed: canEdit } = usePermission('edit_own_content');

  return (
    <ResourceConfigAccessGate
      redirectPath={`/agent/${aid ?? ''}`}
      resourceId={aid}
      resourceType="agent"
    >
      {aid && <AgentMail agentId={aid} disabled={!canEdit} />}
    </ResourceConfigAccessGate>
  );
};

export default AgentMailPage;

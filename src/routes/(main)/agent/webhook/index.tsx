'use client';

import { useParams } from 'react-router';

import AgentWebhook from '@/features/AgentWebhook';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import { usePermission } from '@/hooks/usePermission';

const AgentWebhookPage = () => {
  const { aid } = useParams<{ aid?: string }>();
  const { allowed: canEdit } = usePermission('edit_own_content');

  return (
    <ResourceConfigAccessGate
      redirectPath={`/agent/${aid ?? ''}`}
      resourceId={aid}
      resourceType="agent"
    >
      {aid && <AgentWebhook agentId={aid} disabled={!canEdit} />}
    </ResourceConfigAccessGate>
  );
};

export default AgentWebhookPage;

'use client';

import { memo, Suspense } from 'react';

import AgentShareSkeleton from '@/components/Skeleton/AgentShare';
import AgentShareSettingsPage from '@/features/AgentShareSettings/Page';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import { useParams } from '@/libs/router/navigation';

const AgentSharePage = memo(() => {
  const { aid } = useParams<{ aid: string }>('aid');

  const skeleton = <AgentShareSkeleton />;

  return (
    <Suspense fallback={skeleton}>
      {/* Sharing exposes real execution on the creator's account — a
          configuration action, gated exactly like Agent Profile / Channels. */}
      <ResourceConfigAccessGate
        loading={skeleton}
        redirectPath={`/agent/${aid ?? ''}`}
        resourceId={aid}
        resourceType="agent"
      >
        <AgentShareSettingsPage />
      </ResourceConfigAccessGate>
    </Suspense>
  );
});

export default AgentSharePage;

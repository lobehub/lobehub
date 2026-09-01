'use client';

import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentShareSettingsPage from '@/features/AgentShareSettings/Page';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const AgentSharePage = memo(() => {
  const { aid } = useParams<{ aid: string }>();

  const skeleton = <SurfaceSkeleton variant={'form'} />;

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

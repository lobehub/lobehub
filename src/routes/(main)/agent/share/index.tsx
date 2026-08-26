'use client';

import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentShareSettingsPage from '@/features/AgentShareSettings/Page';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const AgentSharePage = memo(() => {
  const { aid } = useParams<{ aid: string }>();

  // Mirrors the page's real layout (nav header + stacked outlined cards) so
  // loading doesn't flash an unrelated shape.
  const skeleton = <SurfaceSkeleton variant={'sections'} />;

  return (
    <Suspense fallback={skeleton}>
      {/* Sharing exposes real execution on the creator's account — a
          configuration action, gated exactly like Agent Profile / Permission. */}
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

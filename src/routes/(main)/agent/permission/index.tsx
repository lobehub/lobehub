'use client';

import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentPermission from '@/features/AgentPermission';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const AgentPermissionPage = memo(() => {
  const { aid } = useParams<{ aid: string }>();

  return (
    <Suspense fallback={<SurfaceSkeleton variant={'form'} />}>
      {/* Managing who can do what is a configuration action: a chat-only member
          gets the same redirect + reason toast as on Agent Profile. */}
      <ResourceConfigAccessGate
        redirectPath={`/agent/${aid ?? ''}`}
        resourceId={aid}
        resourceType="agent"
      >
        <AgentPermission />
      </ResourceConfigAccessGate>
    </Suspense>
  );
});

export default AgentPermissionPage;

'use client';

import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import GroupPermission from '@/features/GroupPermission';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const GroupPermissionPage = memo(() => {
  const { gid } = useParams<{ gid: string }>();

  return (
    <Suspense fallback={<SurfaceSkeleton variant={'form'} />}>
      {/* Managing who can do what is a configuration action: a chat-only member
          gets the same redirect + reason toast as on Group Profile. */}
      <ResourceConfigAccessGate
        redirectPath={`/group/${gid ?? ''}`}
        resourceId={gid}
        resourceType="agentGroup"
      >
        <GroupPermission />
      </ResourceConfigAccessGate>
    </Suspense>
  );
});

export default GroupPermissionPage;

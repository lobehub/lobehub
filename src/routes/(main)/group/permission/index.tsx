'use client';

import { memo } from 'react';

import GroupPermission from '@/features/GroupPermission';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import { useParams } from '@/libs/router/navigation';

const GroupPermissionPage = memo(() => {
  const { gid } = useParams<{ gid: string }>('gid');

  // Managing who can do what is a configuration action: a chat-only member gets the same redirect + reason toast as on Group Profile.
  return (
    <ResourceConfigAccessGate
      redirectPath={`/group/${gid ?? ''}`}
      resourceId={gid}
      resourceType="agentGroup"
    >
      <GroupPermission />
    </ResourceConfigAccessGate>
  );
});

export default GroupPermissionPage;

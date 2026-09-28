'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import GroupPermission from '@/features/GroupPermission';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';

const GroupPermissionPage = memo(() => {
  const { gid } = useParams<{ gid: string }>();

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

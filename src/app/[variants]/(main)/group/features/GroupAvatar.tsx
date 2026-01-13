'use client';

import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';

import GroupAvatar from '@/features/GroupAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

const SupervisorAvatar = memo<{ size?: number }>(({ size = 28 }) => {
  const memberAvatars = useAgentGroupStore(
    (s) => agentGroupSelectors.currentGroupMemberAvatars(s),
    isEqual,
  );

  return <GroupAvatar avatars={memberAvatars} size={size} />;
});

export default SupervisorAvatar;

'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useParams } from 'react-router';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

/**
 * Connected AgentGroupAvatar that reads from agentGroup store
 */
const CurrentAgentGroupAvatar = memo<{ size?: number }>(({ size = 28 }) => {
  const { gid } = useParams<{ gid: string }>();
  const groupMeta = useAgentGroupStore(
    (s) => agentGroupSelectors.getGroupMeta(gid ?? '')(s),
    isEqual,
  );
  const memberAvatars = useAgentGroupStore(
    (s) => agentGroupSelectors.getGroupMemberAvatars(gid ?? '')(s),
    isEqual,
  );

  return (
    <AgentGroupAvatar
      avatar={groupMeta.avatar}
      backgroundColor={groupMeta.backgroundColor}
      memberAvatars={memberAvatars}
      size={size}
    />
  );
});

export default CurrentAgentGroupAvatar;

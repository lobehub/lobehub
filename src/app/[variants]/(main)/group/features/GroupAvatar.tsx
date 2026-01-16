'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

/**
 * Connected AgentGroupAvatar that reads from agentGroup store
 */
const CurrentAgentGroupAvatar = memo<{ size?: number }>(({ size = 28 }) => {
  const groupMeta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta, isEqual);
  const memberAvatars = useAgentGroupStore(agentGroupSelectors.currentGroupMemberAvatars, isEqual);

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

'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { chatGroupProjectionSelectors, useChatGroupProjection } from '@/projection';

/**
 * Connected AgentGroupAvatar that reads from agentGroup store
 */
const CurrentAgentGroupAvatar = memo<{ size?: number }>(({ size = 28 }) => {
  const { gid } = useActiveRouteParams<{ gid: string }>();
  const groupMeta = useChatGroupProjection(
    chatGroupProjectionSelectors.getGroupMeta(gid ?? ''),
    isEqual,
  );
  const memberAvatars = useChatGroupProjection(
    chatGroupProjectionSelectors.getGroupMemberAvatars(gid ?? ''),
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

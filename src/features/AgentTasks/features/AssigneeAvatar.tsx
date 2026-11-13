import { cssVar, Tooltip } from '@lobehub/ui';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';

import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { UnassignedAssigneeIcon } from './UnassignedAssigneeIcon';

interface AssigneeAvatarProps {
  agentId?: string | null;
  fallbackToDefault?: boolean;
  /** Show the agent's profile card on hover; takes precedence over `tooltip`. */
  profileCard?: boolean;
  size?: number;
  tooltip?: boolean;
}

const AssigneeAvatar = memo<AssigneeAvatarProps>(
  ({ agentId, fallbackToDefault, profileCard, size = 18, tooltip }) => {
    const displayMeta = useAgentDisplayMeta(agentId, { fallbackToDefault });

    if (!displayMeta) {
      return <UnassignedAssigneeIcon kind={'agent'} size={size} />;
    }

    const avatar = (
      <AgentAvatar
        agentId={agentId}
        avatar={displayMeta.avatar}
        background={displayMeta.backgroundColor || cssVar.colorBgContainer}
        shape={'circle'}
        size={size}
        title={displayMeta.title}
        variant={'outlined'}
      />
    );

    if (profileCard && agentId)
      return (
        <AgentProfilePopup
          agentId={agentId}
          trigger={'hover'}
          agent={{
            avatar: displayMeta.avatar,
            backgroundColor: displayMeta.backgroundColor,
            title: displayMeta.title,
          }}
        >
          <span style={{ display: 'inline-flex' }}>{avatar}</span>
        </AgentProfilePopup>
      );

    return tooltip ? (
      <Tooltip title={displayMeta.title}>
        <span style={{ display: 'inline-flex' }}>{avatar}</span>
      </Tooltip>
    ) : (
      avatar
    );
  },
);

export default AssigneeAvatar;

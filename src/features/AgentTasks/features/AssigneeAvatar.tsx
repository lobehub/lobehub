import { cssVar, Tooltip } from '@lobehub/ui';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';

import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { UnassignedAssigneeIcon } from './UnassignedAssigneeIcon';

interface AssigneeAvatarProps {
  agentId?: string | null;
  fallbackToDefault?: boolean;
  size?: number;
  tooltip?: boolean;
}

const AssigneeAvatar = memo<AssigneeAvatarProps>(
  ({ agentId, fallbackToDefault, size = 18, tooltip }) => {
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

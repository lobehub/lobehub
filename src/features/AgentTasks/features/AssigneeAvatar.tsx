import { Tooltip } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

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
      <Avatar
        avatar={displayMeta.avatar}
        background={displayMeta.backgroundColor || cssVar.colorBgContainer}
        shape={'circle'}
        size={size}
        title={displayMeta.title}
        variant={'outlined'}
      />
    );

    return tooltip ? <Tooltip title={displayMeta.title}>{avatar}</Tooltip> : avatar;
  },
);

export default AssigneeAvatar;

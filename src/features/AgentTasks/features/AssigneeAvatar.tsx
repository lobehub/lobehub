import { Avatar } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

interface AssigneeAvatarProps {
  agentId?: string | null;
  size?: number;
}

const AssigneeAvatar = memo<AssigneeAvatarProps>(({ agentId, size = 22 }) => {
  const displayMeta = useAgentDisplayMeta(agentId);

  if (!displayMeta) return null;

  return (
    <Avatar
      avatar={displayMeta.avatar}
      background={displayMeta.backgroundColor || cssVar.colorBgContainer}
      shape={'circle'}
      size={size}
      title={displayMeta.title}
      variant={'outlined'}
    />
  );
});

export default AssigneeAvatar;
